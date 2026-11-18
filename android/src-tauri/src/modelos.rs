//! Reglas puras de los modelos de IA descargables (sin Tauri ni red; probadas en `pruebas/`).
//!
//! El catálogo vive en `src/shared/local-models.ts`; la interfaz manda aquí la dirección, el
//! nombre del archivo, el tamaño y el SHA-256. Rust no se fía: solo descarga de huggingface.co por
//! HTTPS, con un nombre de archivo simple que coincide con el final de la dirección, y comprueba el
//! SHA-256 antes de dar el modelo por bueno.

use std::fs::File;
use std::io::{self, Read};
use std::path::Path;

use sha2::{Digest, Sha256};
use url::Url;

/// Lo que se pide descargar, ya validado.
#[derive(Debug, Clone, PartialEq)]
pub struct Pedido {
    pub url: Url,
    pub archivo: String,
    pub bytes: u64,
    pub sha256: String,
}

/// Nombre de modelo: letras, números, `.`, `-` y `_`; con extensión .bin o .gguf (Whisper y LLM) o
/// .onnx y .onnx.json (voces); sin rutas.
pub fn archivo_valido(nombre: &str) -> bool {
    let simple = !nombre.is_empty()
        && nombre.len() <= 128
        && !nombre.starts_with('.')
        && nombre.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'));
    simple && [".bin", ".gguf", ".onnx", ".onnx.json", ".tokens.txt"].iter().any(|ext| nombre.ends_with(ext))
}

/// Archivos de un modelo de texto en vivo (zipformer streaming) a partir de su identificador
/// («kroko-es.encoder.onnx»): codificador, decodificador, unión y tabla de símbolos.
pub fn archivos_vivo(id: &str) -> Option<[String; 4]> {
    let base = id.strip_suffix(".encoder.onnx")?;
    if base.is_empty() || !archivo_valido(id) {
        return None;
    }
    Some([format!("{base}.encoder.onnx"), format!("{base}.decoder.onnx"), format!("{base}.joiner.onnx"), format!("{base}.tokens.txt")])
}

/// Voz Piper: el identificador de escritorio («es_MX-claude-high»), con su modelo y su configuración.
pub fn voz_valida(id: &str) -> bool {
    !id.is_empty() && !id.contains('.') && archivo_valido(&format!("{id}.onnx"))
}

/// Muestra de una voz: solo las oficiales de rhasspy/piper-voices en Hugging Face.
pub fn url_muestra(url: &str) -> Result<Url, String> {
    let u = Url::parse(url).map_err(|_| "Dirección de muestra inválida.".to_string())?;
    let ok = u.scheme() == "https"
        && u.host_str() == Some("huggingface.co")
        && u.port().is_none()
        && u.query().is_none()
        && u.path().starts_with("/rhasspy/piper-voices/resolve/main/")
        && u.path().ends_with("/speaker_0.mp3")
        && !u.path().contains("..");
    if ok { Ok(u) } else { Err("Solo se escuchan muestras oficiales de las voces Piper.".into()) }
}

/// `tokens.txt` de sherpa-onnx a partir de la configuración Piper (`.onnx.json`): cada símbolo con
/// su número, uno por línea. Es la misma tabla, en el formato que lee sherpa-onnx.
pub fn tokens_piper(config: &str) -> Result<String, String> {
    let v: serde_json::Value = serde_json::from_str(config).map_err(|_| "La configuración de la voz está dañada.".to_string())?;
    let mapa = v.get("phoneme_id_map").and_then(|m| m.as_object()).ok_or("La configuración de la voz no trae su tabla de fonemas.")?;
    let mut lineas: Vec<(i64, &str)> = Vec::with_capacity(mapa.len());
    for (simbolo, ids) in mapa {
        let id = ids.as_array().and_then(|a| a.first()).and_then(|n| n.as_i64()).ok_or("Tabla de fonemas incompleta.")?;
        // sherpa-onnx separa símbolo y número por el último espacio: el símbolo puede ser « ».
        if simbolo.contains('\n') {
            return Err("Tabla de fonemas no válida.".into());
        }
        lineas.push((id, simbolo));
    }
    lineas.sort();
    Ok(lineas.iter().map(|(id, s)| format!("{s} {id}\n")).collect())
}

/// Velocidad de lectura aceptable (la de Ajustes; 1 = normal).
pub fn velocidad_voz(v: f32) -> f32 {
    if v.is_finite() { v.clamp(0.5, 2.0) } else { 1.0 }
}

/// WAV de 16 bits mono a partir de muestras en [-1, 1].
pub fn wav_pcm16(muestras: &[f32], frecuencia: u32) -> Vec<u8> {
    let datos = (muestras.len() * 2) as u32;
    let mut w = Vec::with_capacity(44 + datos as usize);
    w.extend_from_slice(b"RIFF");
    w.extend_from_slice(&(36 + datos).to_le_bytes());
    w.extend_from_slice(b"WAVEfmt ");
    w.extend_from_slice(&16u32.to_le_bytes());
    w.extend_from_slice(&1u16.to_le_bytes()); // PCM
    w.extend_from_slice(&1u16.to_le_bytes()); // mono
    w.extend_from_slice(&frecuencia.to_le_bytes());
    w.extend_from_slice(&(frecuencia * 2).to_le_bytes());
    w.extend_from_slice(&2u16.to_le_bytes());
    w.extend_from_slice(&16u16.to_le_bytes());
    w.extend_from_slice(b"data");
    w.extend_from_slice(&datos.to_le_bytes());
    for m in muestras {
        let v = if m.is_finite() { (m.clamp(-1.0, 1.0) * 32767.0).round() as i16 } else { 0 };
        w.extend_from_slice(&v.to_le_bytes());
    }
    w
}

pub fn validar_pedido(url: &str, archivo: &str, bytes: u64, sha256: &str) -> Result<Pedido, String> {
    if !archivo_valido(archivo) {
        return Err(format!("Nombre de modelo no válido: «{archivo}»."));
    }
    let url = Url::parse(url).map_err(|_| "Dirección de descarga inválida.".to_string())?;
    if url.scheme() != "https" || url.host_str() != Some("huggingface.co") || url.port().is_some() {
        return Err("Los modelos solo se descargan de https://huggingface.co.".into());
    }
    // El archivo se guarda con el nombre de la dirección, o con un prefijo («kroko-es.encoder.onnx»
    // para …/encoder.onnx) cuando varios modelos traen archivos con el mismo nombre.
    let ultimo = url.path_segments().and_then(|mut s| s.next_back()).unwrap_or("");
    let prefijado = archivo.strip_suffix(ultimo).and_then(|p| p.strip_suffix('.')).is_some_and(|p| !p.is_empty() && !p.contains('.'));
    if ultimo.is_empty() || (archivo != ultimo && !prefijado) {
        return Err("La dirección no corresponde al archivo del modelo.".into());
    }
    let sha = sha256.to_ascii_lowercase();
    if sha.len() != 64 || !sha.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Falta la huella SHA-256 del modelo.".into());
    }
    if bytes == 0 {
        return Err("Falta el tamaño del modelo.".into());
    }
    Ok(Pedido { url, archivo: archivo.to_string(), bytes, sha256: sha })
}

/// SHA-256 de un archivo, en hexadecimal (se lee por bloques: los modelos pesan GB).
pub fn sha256_archivo(ruta: &Path) -> io::Result<String> {
    let mut f = File::open(ruta)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// Espacio que hace falta para terminar una descarga: lo que falta más un margen de 200 MB, para
/// no dejar el teléfono sin espacio.
pub fn espacio_necesario(total: u64, ya_descargado: u64) -> u64 {
    total.saturating_sub(ya_descargado) + 200 * 1024 * 1024
}


/// Audio PCM que llega de la interfaz en base64, como muestras de 16 bits (little-endian). Por el
/// puente de Android el cuerpo binario llega como lista JSON de bytes (16 caracteres por muestra);
/// así son menos de 3.
pub fn pcm_desde_b64(texto: &str) -> Result<Vec<f32>, String> {
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD.decode(texto).map_err(|_| "Audio dañado.".to_string())?;
    if bytes.len() % 2 != 0 {
        return Err("Audio dañado: el tamaño no es múltiplo de 2 bytes.".into());
    }
    Ok(bytes.chunks_exact(2).map(|c| i16::from_le_bytes([c[0], c[1]]) as f32 / 32768.0).collect())
}

/// Cómo correr Whisper para un audio.
#[derive(Debug, PartialEq)]
pub struct PlanWhisper {
    /// `audio_ctx` (0 = ventana completa).
    pub ventana: i32,
    /// Ancho de la búsqueda en haz (1 = voraz).
    pub haz: i32,
    /// Quitar los silencios con el detector de voz antes de transcribir.
    pub vad: bool,
}

/// Frases de dictado (hasta 15 s): búsqueda en haz de 3, más precisa y aún rápida. Audios largos
/// (reuniones, archivos): voraz, porque ahí importa no acumular atraso, y con el detector de voz,
/// que quita los silencios (menos trabajo y sin texto inventado en los huecos). Los borradores,
/// siempre lo más rápido.
pub fn plan_whisper(muestras: usize, marcas: bool, borrador: bool, hay_vad: bool) -> PlanWhisper {
    let segundos = muestras as f64 / 16_000.0;
    PlanWhisper {
        ventana: if marcas { 0 } else { contexto_audio(muestras) },
        haz: if !borrador && segundos <= 15.0 { 3 } else { 1 },
        vad: !borrador && hay_vad && segundos >= 8.0,
    }
}

/// Texto de arranque para Whisper: como mucho 600 caracteres, sin saltos de línea.
pub fn prompt_whisper(texto: &str) -> String {
    let limpio: String = texto.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    limpio.trim().chars().take(600).collect()
}

/// Idioma para Whisper: código ISO de 2 letras («es», «en»…) o `None` para detectarlo.
pub fn idioma_whisper(lang: &str) -> Result<Option<String>, String> {
    match lang {
        "" | "auto" => Ok(None),
        l if l.len() == 2 && l.bytes().all(|b| b.is_ascii_lowercase()) => Ok(Some(l.to_string())),
        l => Err(format!("Idioma no válido: «{l}».")),
    }
}

/// Ventana del codificador de Whisper (`audio_ctx`) para un audio de `muestras` a 16 kHz.
///
/// Whisper siempre codifica 30 s (1500 posiciones, 50 por segundo) aunque la frase dure 5: en un
/// teléfono eso es la mayor parte del tiempo. Se ajusta a la duración real más un margen (un
/// contexto demasiado justo hace que Whisper repita o invente texto). 0 = ventana completa.
pub fn contexto_audio(muestras: usize) -> i32 {
    let posiciones = (muestras as f64 / 16_000.0 * 50.0).ceil() as i32 + 128;
    if posiciones >= 1500 { 0 } else { posiciones.max(384) }
}

/// Contexto máximo del LLM en el teléfono: 8 K tokens (la caché ocupa RAM y el prompt tarda en leerse).
const CTX_MAX: u32 = 8192;
/// Respuesta más larga que se genera (un acta o unas notas caben de sobra).
const RESPUESTA_MAX: usize = 2048;

/// Tamaño del contexto y máximo de tokens a generar para un prompt de `prompt` tokens, en un
/// modelo entrenado con `entrenado` tokens de contexto. Error si el texto no cabe.
pub fn contexto_llm(prompt: usize, entrenado: u32) -> Result<(u32, usize), String> {
    let limite = if entrenado == 0 { CTX_MAX } else { entrenado.min(CTX_MAX) } as usize;
    // Hace falta sitio para al menos una respuesta corta.
    if prompt + 256 > limite {
        return Err(format!(
            "El texto es demasiado largo para el modelo del teléfono ({prompt} tokens; caben unos {}). Divídelo en partes.",
            limite - 256
        ));
    }
    let nuevos = RESPUESTA_MAX.min(limite - prompt);
    // Se reserva solo lo necesario, redondeado a 256: menos RAM para textos cortos.
    let ctx = (prompt + nuevos).div_ceil(256) * 256;
    Ok((ctx.min(limite) as u32, nuevos))
}

/// Cuántos tokens del principio de `nuevo` ya están leídos en la caché del modelo. Siempre deja
/// al menos uno sin reutilizar: hace falta leerlo para obtener la primera palabra de la respuesta.
pub fn prefijo_comun<T: PartialEq>(cache: &[T], nuevo: &[T]) -> usize {
    let comun = cache.iter().zip(nuevo).take_while(|(a, b)| a == b).count();
    comun.min(nuevo.len().saturating_sub(1))
}

/// Quita el razonamiento (`<think>…</think>`) que algunos modelos escriben antes de responder.
pub fn limpiar_respuesta(texto: &str) -> String {
    let mut t = texto.to_string();
    while let Some(i) = t.find("<think>") {
        match t[i..].find("</think>") {
            Some(f) => t.replace_range(i..i + f + "</think>".len(), ""),
            None => t.truncate(i),
        }
    }
    t.trim().to_string()
}

#[cfg(test)]
mod pruebas_motor {
    use super::*;

    #[test]
    fn pcm_en_base64_de_16_bits() {
        use base64::Engine as _;
        let bytes: Vec<u8> = [0i16, 16384, -32768, 32767].iter().flat_map(|v| v.to_le_bytes()).collect();
        let pcm = pcm_desde_b64(&base64::engine::general_purpose::STANDARD.encode(bytes)).unwrap();
        assert_eq!(pcm.len(), 4);
        assert_eq!(pcm[0], 0.0);
        assert_eq!(pcm[1], 0.5);
        assert_eq!(pcm[2], -1.0);
        assert!(pcm_desde_b64("no es base64!").is_err());
        assert!(pcm_desde_b64("AAAA").is_err()); // 3 bytes: tamaño impar
    }

    #[test]
    fn plan_segun_el_audio() {
        assert_eq!(plan_whisper(16_000 * 5, false, false, true), PlanWhisper { ventana: 384, haz: 3, vad: false });
        assert_eq!(plan_whisper(16_000 * 5, false, true, true).haz, 1);
        let largo = plan_whisper(16_000 * 25, false, false, true);
        assert_eq!((largo.haz, largo.vad), (1, true));
        assert!(!plan_whisper(16_000 * 25, false, false, false).vad);
        assert_eq!(plan_whisper(16_000 * 25, true, false, true).ventana, 0);
    }

    #[test]
    fn archivos_del_modelo_en_vivo() {
        let a = archivos_vivo("kroko-es.encoder.onnx").unwrap();
        assert_eq!(a[3], "kroko-es.tokens.txt");
        assert!(archivos_vivo("kroko-es.onnx").is_none());
        assert!(archivos_vivo(".encoder.onnx").is_none());
        assert!(archivos_vivo("../x.encoder.onnx").is_none());
    }

    #[test]
    fn nombre_con_prefijo_para_archivos_repetidos() {
        const SHA: &str = "2d9f5ef87d1a5257f8a6687e21501c56f3aa2fcbfcfab9364dcc4ce4e06ae81b";
        let url = "https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-es-kroko-2025-08-06/resolve/main/encoder.onnx";
        assert!(validar_pedido(url, "kroko-es.encoder.onnx", 1, SHA).is_ok());
        assert!(validar_pedido(url, "encoder.onnx", 1, SHA).is_ok());
        assert!(validar_pedido(url, "kroko.es.encoder.onnx", 1, SHA).is_err());
        assert!(validar_pedido(url, "kroko-es.decoder.onnx", 1, SHA).is_err());
        assert!(validar_pedido(url, "xencoder.onnx", 1, SHA).is_err());
        let tokens = "https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-es-kroko-2025-08-06/resolve/main/tokens.txt";
        assert!(validar_pedido(tokens, "kroko-es.tokens.txt", 1, SHA).is_ok());
        assert!(validar_pedido(tokens, "tokens.txt", 1, SHA).is_err()); // sin prefijo no es un nombre válido
    }

    #[test]
    fn prompt_limpio_y_corto() {
        assert_eq!(prompt_whisper(" Hola.\nAdiós "), "Hola. Adiós");
        assert_eq!(prompt_whisper(&"a".repeat(900)).len(), 600);
    }
}

#[cfg(test)]
mod pruebas {
    use super::*;

    const SHA: &str = "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898";
    const URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin";

    #[test]
    fn nombres_de_archivo() {
        assert!(archivo_valido("ggml-base-q5_1.bin"));
        assert!(archivo_valido("Qwen3-4B-Instruct-2507-Q4_K_M.gguf"));
        assert!(archivo_valido("es_MX-claude-high.onnx"));
        assert!(archivo_valido("es_MX-claude-high.onnx.json"));
        assert!(!archivo_valido("datos.json"));
        assert!(!archivo_valido("../datos/settings.json"));
        assert!(!archivo_valido("a/b.gguf"));
        assert!(!archivo_valido(".gguf"));
        assert!(!archivo_valido("modelo.exe"));
        assert!(!archivo_valido(""));
    }

    #[test]
    fn pedidos_validos_e_invalidos() {
        let p = validar_pedido(URL, "ggml-base-q5_1.bin", 59707625, &SHA.to_uppercase()).unwrap();
        assert_eq!(p.sha256, SHA);
        assert!(validar_pedido("http://huggingface.co/x/resolve/main/ggml-base-q5_1.bin", "ggml-base-q5_1.bin", 1, SHA).is_err());
        assert!(validar_pedido("https://evil.com/ggml-base-q5_1.bin", "ggml-base-q5_1.bin", 1, SHA).is_err());
        assert!(validar_pedido("https://huggingface.co.evil.com/ggml-base-q5_1.bin", "ggml-base-q5_1.bin", 1, SHA).is_err());
        assert!(validar_pedido("https://huggingface.co:8443/x/ggml-base-q5_1.bin", "ggml-base-q5_1.bin", 1, SHA).is_err());
        assert!(validar_pedido(URL, "ggml-small-q5_1.bin", 1, SHA).is_err());
        assert!(validar_pedido(URL, "ggml-base-q5_1.bin", 1, "abc").is_err());
        assert!(validar_pedido(URL, "ggml-base-q5_1.bin", 0, SHA).is_err());
    }

    #[test]
    fn huella_de_un_archivo() {
        let ruta = std::env::temp_dir().join(format!("dictaflow-sha-{}", std::process::id()));
        std::fs::write(&ruta, b"abc").unwrap();
        assert_eq!(sha256_archivo(&ruta).unwrap(), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        let _ = std::fs::remove_file(&ruta);
    }

    #[test]
    fn audio_e_idioma() {
        assert_eq!(idioma_whisper("es").unwrap(), Some("es".into()));
        assert_eq!(idioma_whisper("auto").unwrap(), None);
        assert!(idioma_whisper("es-MX").is_err());
    }

    #[test]
    fn ventana_de_audio() {
        assert_eq!(contexto_audio(16_000), 384); // 1 s: mínimo con margen
        assert_eq!(contexto_audio(16_000 * 7), 350 + 128);
        assert_eq!(contexto_audio(16_000 * 27), 1350 + 128);
        assert_eq!(contexto_audio(16_000 * 29), 0); // casi 30 s: ventana completa
        assert_eq!(contexto_audio(16_000 * 120), 0);
    }

    #[test]
    fn contexto_del_llm() {
        assert_eq!(contexto_llm(300, 32768).unwrap(), (2560, 2048));
        assert_eq!(contexto_llm(7000, 32768).unwrap(), (8192, 1192));
        assert_eq!(contexto_llm(300, 2048).unwrap(), (2048, 1748));
        assert_eq!(contexto_llm(300, 0).unwrap(), (2560, 2048));
        assert!(contexto_llm(8000, 32768).is_err());
    }

    #[test]
    fn prefijo_reutilizable() {
        assert_eq!(prefijo_comun(&[1, 2, 3, 9, 9], &[1, 2, 3, 4]), 3);
        assert_eq!(prefijo_comun(&[1, 2, 3], &[1, 2, 3]), 2); // el último se vuelve a leer
        assert_eq!(prefijo_comun(&[5], &[1, 2]), 0);
        assert_eq!(prefijo_comun::<u8>(&[], &[]), 0);
    }

    #[test]
    fn respuesta_sin_razonamiento() {
        assert_eq!(limpiar_respuesta("<think>\nmm\n</think>\n\nHola."), "Hola.");
        assert_eq!(limpiar_respuesta("  Hola.  "), "Hola.");
        assert_eq!(limpiar_respuesta("Hola.<think>sin cerrar"), "Hola.");
    }

    #[test]
    fn voces() {
        assert!(voz_valida("es_MX-claude-high"));
        assert!(voz_valida("en_US-hfc_female-medium"));
        assert!(!voz_valida("../x"));
        assert!(!voz_valida("x.onnx"));
        assert!(!voz_valida(""));

        let ok = "https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_MX/claude/high/samples/speaker_0.mp3";
        assert!(url_muestra(ok).is_ok());
        assert!(url_muestra(&ok.replace("https", "http")).is_err());
        assert!(url_muestra("https://huggingface.co/otro/repo/resolve/main/samples/speaker_0.mp3").is_err());
        assert!(url_muestra(&format!("{ok}?x=1")).is_err());
        assert!(url_muestra("https://evil.com/rhasspy/piper-voices/resolve/main/speaker_0.mp3").is_err());
    }

    #[test]
    fn tabla_de_fonemas() {
        let cfg = r#"{"audio":{"sample_rate":22050},"phoneme_id_map":{"_":[0],"^":[1]," ":[3],"a":[14],"ɲ":[120]}}"#;
        assert_eq!(tokens_piper(cfg).unwrap(), "_ 0\n^ 1\n  3\na 14\nɲ 120\n");
        assert!(tokens_piper("{}").is_err());
        assert!(tokens_piper("no es json").is_err());
        assert!(tokens_piper(r#"{"phoneme_id_map":{"a":[]}}"#).is_err());
    }

    #[test]
    fn audio_wav() {
        let w = wav_pcm16(&[0.0, 1.0, -1.0, 2.0, f32::NAN], 22050);
        assert_eq!(w.len(), 44 + 10);
        assert_eq!(&w[0..4], b"RIFF");
        assert_eq!(u32::from_le_bytes(w[4..8].try_into().unwrap()), 36 + 10);
        assert_eq!(u32::from_le_bytes(w[24..28].try_into().unwrap()), 22050);
        assert_eq!(u32::from_le_bytes(w[40..44].try_into().unwrap()), 10);
        let m: Vec<i16> = w[44..].chunks(2).map(|c| i16::from_le_bytes([c[0], c[1]])).collect();
        assert_eq!(m, vec![0, 32767, -32767, 32767, 0]);
        assert_eq!(velocidad_voz(1.2), 1.2);
        assert_eq!(velocidad_voz(9.0), 2.0);
        assert_eq!(velocidad_voz(f32::NAN), 1.0);
    }

    #[test]
    fn espacio() {
        assert_eq!(espacio_necesario(1000, 0), 1000 + 200 * 1024 * 1024);
        assert_eq!(espacio_necesario(1000, 1000), 200 * 1024 * 1024);
        assert_eq!(espacio_necesario(1000, 5000), 200 * 1024 * 1024);
    }
}
