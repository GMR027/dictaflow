//! Lectura en voz alta dentro del teléfono: voces Piper con sherpa-onnx (onnxruntime + espeak-ng).
//!
//! Las voces son las de escritorio, en la copia preparada para sherpa-onnx; se descargan en
//! `modelos/` como `<voz>.onnx` y `<voz>.onnx.json` (src/shared/local-models.ts). La tabla de
//! fonemas que pide sherpa-onnx (`tokens.txt`) se escribe a partir del `.onnx.json`, y los datos de
//! espeak-ng (cómo se pronuncia cada palabra en español e inglés) van dentro de la app.
//!
//! La voz se queda cargada entre frases (cargarla tarda ~1 s); se atiende una petición a la vez.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use piper_plus_g2p::{english::EnglishPhonemizer, spanish::SpanishPhonemizer, Phonemizer};
use sherpa_onnx::{
    GenerationConfig, OfflineTts, OfflineTtsConfig, OfflineTtsKokoroModelConfig,
    OfflineTtsModelConfig, OfflineTtsSupertonicModelConfig, OfflineTtsVitsModelConfig,
};

use crate::modelos::{
    idioma_kokoro, idioma_supertonic, tokens_piper, velocidad_voz, voz_valida, wav_pcm16,
    KOKORO_VOCES, SUPERTONIC_ARCHIVOS, SUPERTONIC_VOCES,
};

/// Datos de espeak-ng para es/en (android/herramientas/espeak-ng-data.py).
static ESPEAK: &[u8] = include_bytes!("../recursos/espeak-ng-data.tar");

/// `tts.json` del modelo Supertonic 3: describe el vocoder y fija 44.1 kHz. Es pequeño y define el
/// contrato de los cuatro grafos, así que viaja dentro de la app en vez de descargarse.
static SUPERTONIC_TTS_JSON: &str = include_str!("../recursos/supertonic-tts.json");

pub struct Tts {
    modelos: PathBuf,
    /// Carpeta propia: datos de espeak-ng y tablas de fonemas.
    dir: PathBuf,
    motor: Mutex<Option<(String, OfflineTts)>>,
    /// sherpa-onnx 2.x exige los fonemas ya convertidos a IPA. Se cargan una sola vez.
    fonemas_en: OnceLock<EnglishPhonemizer>,
    fonemas_es: OnceLock<SpanishPhonemizer>,
}

fn hilos() -> i32 {
    std::thread::available_parallelism().map(|n| n.get().min(4)).unwrap_or(2) as i32
}

impl Tts {
    pub fn new(modelos: PathBuf, dir: PathBuf) -> Self {
        Self {
            modelos,
            dir,
            motor: Mutex::new(None),
            fonemas_en: OnceLock::new(),
            fonemas_es: OnceLock::new(),
        }
    }

    /// IPA para Piper/Kokoro. El trino español usa un alias PUA que los modelos no conocen: se
    /// cambia por «r», que es el símbolo que sí está en sus tablas.
    fn fonemas(&self, idioma: &str, texto: &str) -> Result<Vec<i32>, String> {
        let (tokens, _) = if idioma == "es" {
            self.fonemas_es
                .get_or_init(SpanishPhonemizer::new)
                .phonemize_with_prosody(texto)
                .map_err(|e| format!("No se pudo preparar la pronunciación: {e}"))?
        } else {
            let p = match self.fonemas_en.get() {
                Some(p) => p,
                None => {
                    let p = EnglishPhonemizer::new_bundled()
                        .map_err(|e| format!("No se pudo preparar la pronunciación: {e}"))?;
                    let _ = self.fonemas_en.set(p);
                    self.fonemas_en.get().expect("fonemas inglés")
                }
            };
            p.phonemize_with_prosody(texto)
                .map_err(|e| format!("No se pudo preparar la pronunciación: {e}"))?
        };
        Ok(tokens
            .concat()
            .chars()
            .map(|c| (if c == '\u{e01d}' { 'r' } else { c }) as i32)
            .collect::<Vec<_>>())
    }

    /// Extrae los datos de espeak-ng la primera vez (o si cambiaron con una actualización de la app).
    fn espeak(&self) -> Result<PathBuf, String> {
        let destino = self.dir.join("espeak-ng-data");
        let marca = self.dir.join("espeak-ng-data.version");
        let version = format!("{}", ESPEAK.len());
        if destino.is_dir() && fs::read_to_string(&marca).ok().as_deref() == Some(version.as_str()) {
            return Ok(destino);
        }
        let error = |e: std::io::Error| format!("No se pudieron preparar los datos de pronunciación: {e}");
        if destino.exists() {
            fs::remove_dir_all(&destino).map_err(error)?;
        }
        fs::create_dir_all(&self.dir).map_err(error)?;
        tar::Archive::new(ESPEAK).unpack(&self.dir).map_err(error)?;
        fs::write(&marca, version).map_err(error)?;
        Ok(destino)
    }

    fn cargar(&self, voz: &str) -> Result<OfflineTts, String> {
        let modelo = self.modelos.join(format!("{voz}.onnx"));
        let config = self.modelos.join(format!("{voz}.onnx.json"));
        if !modelo.is_file() || !config.is_file() {
            return Err("Falta descargar esta voz (Ajustes → Servicios de IA).".into());
        }
        let datos = self.espeak()?;
        let tabla = fs::read_to_string(&config).map_err(|e| format!("No se pudo leer la voz: {e}"))?;
        let tokens = self.dir.join("tokens").join(format!("{voz}.txt"));
        fs::create_dir_all(tokens.parent().unwrap()).map_err(|e| e.to_string())?;
        fs::write(&tokens, tokens_piper(&tabla)?).map_err(|e| e.to_string())?;

        let ruta = |p: &Path| Some(p.to_string_lossy().into_owned());
        let cfg = OfflineTtsConfig {
            model: OfflineTtsModelConfig {
                vits: OfflineTtsVitsModelConfig {
                    model: ruta(&modelo),
                    tokens: ruta(&tokens),
                    data_dir: ruta(&datos),
                    ..Default::default()
                },
                num_threads: hilos(),
                provider: Some("cpu".into()),
                ..Default::default()
            },
            // Una frase por vez: el primer audio llega antes.
            max_num_sentences: 1,
            silence_scale: 0.2,
            ..Default::default()
        };
        OfflineTts::create(&cfg).ok_or_else(|| "No se pudo cargar la voz. Bórrala y vuelve a descargarla.".to_string())
    }

    /// Kokoro (int8, 54 voces en un modelo). El idioma decide cómo se pronuncia: inglés con su
    /// léxico (EE. UU. o Reino Unido); español con espeak-ng (los mismos datos que Piper). Medido en
    /// el teléfono: unos 5,5 s para 4,7 s de audio (Piper es varias veces más rápido).
    fn cargar_kokoro(&self, idioma: &str) -> Result<OfflineTts, String> {
        let f = |n: &str| self.modelos.join(format!("kokoro.{n}"));
        let (modelo, voces, tokens) = (f("model.int8.onnx"), f("voices.bin"), f("tokens.txt"));
        let lexico = match idioma {
            "en-us" => Some(f("lexicon-us-en.txt")),
            "en-gb" => Some(f("lexicon-gb-en.txt")),
            _ => None,
        };
        if ![&modelo, &voces, &tokens].iter().all(|p| p.is_file()) || lexico.as_ref().is_some_and(|l| !l.is_file()) {
            return Err("Falta descargar Kokoro (Ajustes → Servicios de IA → Lectura en voz alta).".into());
        }
        let datos = self.espeak()?;
        let ruta = |p: &Path| Some(p.to_string_lossy().into_owned());
        let cfg = OfflineTtsConfig {
            model: OfflineTtsModelConfig {
                kokoro: OfflineTtsKokoroModelConfig {
                    model: ruta(&modelo),
                    voices: ruta(&voces),
                    tokens: ruta(&tokens),
                    data_dir: ruta(&datos),
                    lexicon: lexico.as_deref().and_then(ruta),
                    // espeak-ng (para lo que no está en el léxico) no trae «en-gb» en los datos de la
                    // app: el acento británico lo dan su léxico y la voz.
                    lang: Some(if idioma.starts_with("en") { "en-us".to_string() } else { idioma.to_string() }),
                    length_scale: 1.0,
                    ..Default::default()
                },
                num_threads: hilos(),
                provider: Some("cpu".into()),
                ..Default::default()
            },
            max_num_sentences: 1,
            silence_scale: 0.2,
            ..Default::default()
        };
        OfflineTts::create(&cfg).ok_or_else(|| "No se pudo cargar Kokoro. Bórralo y vuelve a descargarlo.".to_string())
    }

    /// Supertonic 3 (int8): cuatro grafos ONNX, 10 voces y 31 idiomas. El `tts.json` va incrustado;
    /// los demás archivos se descargan en `modelos/`. Cargar el motor tarda unos segundos y ocupa
    /// bastante RAM, así que solo se hace cuando se elige una voz Supertonic.
    fn cargar_supertonic(&self) -> Result<OfflineTts, String> {
        let f = |n: &str| self.modelos.join(n);
        let [duration, text, vector, vocoder, unicode, voice] = SUPERTONIC_ARCHIVOS.map(f);
        if ![&duration, &text, &vector, &vocoder, &unicode, &voice].iter().all(|p| p.is_file()) {
            return Err("Falta descargar Supertonic (Ajustes → Servicios de IA → Lectura en voz alta).".into());
        }
        let carpeta = self.dir.join("supertonic");
        fs::create_dir_all(&carpeta).map_err(|e| format!("No se pudo preparar Supertonic: {e}"))?;
        let tts_json = carpeta.join("tts.json");
        if fs::read_to_string(&tts_json).ok().as_deref() != Some(SUPERTONIC_TTS_JSON) {
            fs::write(&tts_json, SUPERTONIC_TTS_JSON).map_err(|e| format!("No se pudo preparar Supertonic: {e}"))?;
        }

        let ruta = |p: &Path| Some(p.to_string_lossy().into_owned());
        let cfg = OfflineTtsConfig {
            model: OfflineTtsModelConfig {
                supertonic: OfflineTtsSupertonicModelConfig {
                    duration_predictor: ruta(&duration),
                    text_encoder: ruta(&text),
                    vector_estimator: ruta(&vector),
                    vocoder: ruta(&vocoder),
                    tts_json: ruta(&tts_json),
                    unicode_indexer: ruta(&unicode),
                    voice_style: ruta(&voice),
                },
                num_threads: hilos(),
                provider: Some("cpu".into()),
                ..Default::default()
            },
            // El propio motor trocea el texto (300 caracteres; 120 en coreano/japonés).
            max_num_sentences: 1,
            silence_scale: 0.2,
            ..Default::default()
        };
        OfflineTts::create(&cfg).ok_or_else(|| "No se pudo cargar Supertonic. Bórralo y vuelve a descargarlo.".to_string())
    }

    /// Lee `texto` con la voz `sid` de Supertonic y devuelve un WAV a 44.1 kHz.
    pub fn sintetizar_supertonic(&self, sid: i32, idioma: &str, texto: &str, velocidad: f32) -> Result<Vec<u8>, String> {
        if !(0..SUPERTONIC_VOCES).contains(&sid) {
            return Err(format!("Voz de Supertonic no válida: {sid}."));
        }
        let idioma = idioma_supertonic(idioma)?;
        let texto = texto.split_whitespace().collect::<Vec<_>>().join(" ");
        if texto.is_empty() {
            return Err("No hay texto que leer.".into());
        }
        let mut motor = self.motor.lock().unwrap();
        if motor.as_ref().is_none_or(|(id, _)| id != "supertonic") {
            *motor = None;
            *motor = Some(("supertonic".into(), self.cargar_supertonic()?));
        }
        let (_, tts) = motor.as_ref().expect("voz cargada");
        let mut extra = HashMap::new();
        extra.insert("lang".to_string(), serde_json::json!(idioma));
        let opciones = GenerationConfig {
            sid,
            // Más pasos = mejor calidad; 8 es el valor validado por Supertonic.
            num_steps: 8,
            speed: velocidad_voz(velocidad),
            extra: Some(extra),
            ..Default::default()
        };
        let audio = tts
            .generate_with_config(&texto, &opciones, None::<fn(&[f32], f32) -> bool>)
            .ok_or("Supertonic no pudo leer este texto.")?;
        Ok(wav_pcm16(audio.samples(), audio.sample_rate() as u32))
    }

    /// Lee `texto` con la voz número `sid` de Kokoro y devuelve un WAV.
    pub fn sintetizar_kokoro(&self, sid: i32, idioma: &str, texto: &str, velocidad: f32) -> Result<Vec<u8>, String> {
        if !(0..KOKORO_VOCES).contains(&sid) {
            return Err(format!("Voz de Kokoro no válida: {sid}."));
        }
        let idioma = idioma_kokoro(idioma)?;
        let texto = texto.split_whitespace().collect::<Vec<_>>().join(" ");
        if texto.is_empty() {
            return Err("No hay texto que leer.".into());
        }
        // En inglés usa el léxico que trae Kokoro; en español, los IPA de piper-plus-g2p.
        let fonemas = if idioma == "es" { Some(vec![self.fonemas("es", &texto)?]) } else { None };
        let clave = format!("kokoro|{idioma}");
        let mut motor = self.motor.lock().unwrap();
        if motor.as_ref().is_none_or(|(id, _)| *id != clave) {
            *motor = None;
            *motor = Some((clave, self.cargar_kokoro(idioma)?));
        }
        let (_, tts) = motor.as_ref().expect("voz cargada");
        let opciones = GenerationConfig {
            speed: velocidad_voz(velocidad),
            sid,
            phoneme_codepoints: fonemas,
            ..Default::default()
        };
        let audio = tts
            .generate_with_config(&texto, &opciones, None::<fn(&[f32], f32) -> bool>)
            .ok_or("Kokoro no pudo leer este texto.")?;
        Ok(wav_pcm16(audio.samples(), audio.sample_rate() as u32))
    }

    /// Lee `texto` con la voz `voz` y devuelve un WAV.
    pub fn sintetizar(&self, voz: &str, texto: &str, velocidad: f32) -> Result<Vec<u8>, String> {
        if !voz_valida(voz) {
            return Err(format!("Voz no válida: «{voz}»."));
        }
        let texto = texto.split_whitespace().collect::<Vec<_>>().join(" ");
        if texto.is_empty() {
            return Err("No hay texto que leer.".into());
        }
        // sherpa-onnx 2.x ya no phonemiza Piper: se le pasan los IPA preparados.
        let idioma = if voz.starts_with("es") { "es" } else { "en" };
        let fonemas = vec![self.fonemas(idioma, &texto)?];
        let mut motor = self.motor.lock().unwrap();
        if motor.as_ref().is_none_or(|(id, _)| id != voz) {
            // Se libera la anterior antes de cargar otra.
            *motor = None;
            *motor = Some((voz.to_string(), self.cargar(voz)?));
        }
        let (_, tts) = motor.as_ref().expect("voz cargada");
        let opciones = GenerationConfig {
            speed: velocidad_voz(velocidad),
            sid: 0,
            phoneme_codepoints: Some(fonemas),
            ..Default::default()
        };
        let audio = tts
            .generate_with_config(&texto, &opciones, None::<fn(&[f32], f32) -> bool>)
            .ok_or("La voz no pudo leer este texto.")?;
        Ok(wav_pcm16(audio.samples(), audio.sample_rate() as u32))
    }

    /// Libera el motor cargado (para devolver la RAM al salir del lector o de una exportación).
    pub fn liberar(&self) {
        *self.motor.lock().unwrap() = None;
    }

    /// Libera la voz cargada si se borra su archivo.
    pub fn olvidar(&self, voz: &str) {
        let mut motor = self.motor.lock().unwrap();
        if motor.as_ref().is_some_and(|(id, _)| {
            id == voz
                || (voz == "kokoro" && id.starts_with("kokoro|"))
                || (voz == "supertonic" && id == "supertonic")
        }) {
            *motor = None;
        }
    }
}
