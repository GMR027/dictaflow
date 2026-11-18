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

/// Nombre de modelo: letras, números, `.`, `-` y `_`; con extensión .bin o .gguf; sin rutas.
pub fn archivo_valido(nombre: &str) -> bool {
    let simple = !nombre.is_empty()
        && nombre.len() <= 128
        && !nombre.starts_with('.')
        && nombre.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'));
    simple && (nombre.ends_with(".bin") || nombre.ends_with(".gguf"))
}

pub fn validar_pedido(url: &str, archivo: &str, bytes: u64, sha256: &str) -> Result<Pedido, String> {
    if !archivo_valido(archivo) {
        return Err(format!("Nombre de modelo no válido: «{archivo}»."));
    }
    let url = Url::parse(url).map_err(|_| "Dirección de descarga inválida.".to_string())?;
    if url.scheme() != "https" || url.host_str() != Some("huggingface.co") || url.port().is_some() {
        return Err("Los modelos solo se descargan de https://huggingface.co.".into());
    }
    if url.path_segments().and_then(|mut s| s.next_back()) != Some(archivo) {
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

/// Audio PCM que llega de la interfaz como bytes crudos (Float32Array, little-endian).
pub fn pcm_desde_bytes(bytes: &[u8]) -> Result<Vec<f32>, String> {
    if bytes.len() % 4 != 0 {
        return Err("Audio dañado: el tamaño no es múltiplo de 4 bytes.".into());
    }
    Ok(bytes.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect())
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
mod pruebas {
    use super::*;

    const SHA: &str = "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898";
    const URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin";

    #[test]
    fn nombres_de_archivo() {
        assert!(archivo_valido("ggml-base-q5_1.bin"));
        assert!(archivo_valido("Qwen3-4B-Instruct-2507-Q4_K_M.gguf"));
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
        let bytes: Vec<u8> = [0.5f32, -1.0].iter().flat_map(|f| f.to_le_bytes()).collect();
        assert_eq!(pcm_desde_bytes(&bytes).unwrap(), vec![0.5, -1.0]);
        assert!(pcm_desde_bytes(&[0, 1, 2]).is_err());
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
    fn espacio() {
        assert_eq!(espacio_necesario(1000, 0), 1000 + 200 * 1024 * 1024);
        assert_eq!(espacio_necesario(1000, 1000), 200 * 1024 * 1024);
        assert_eq!(espacio_necesario(1000, 5000), 200 * 1024 * 1024);
    }
}
