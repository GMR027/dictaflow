//! Voz → texto con whisper.cpp dentro de la app (whisper-rs).
//!
//! El modelo (GGML, descargado en Ajustes → Servicios de IA) se carga una vez y se reutiliza.
//! Igual que en escritorio (`src/main/stt-queue.ts`), la frase definitiva nunca espera a un
//! borrador: si el motor está ocupado, el borrador se omite (devuelve texto vacío) en vez de hacer
//! cola delante de la frase que importa.

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;

use serde::Serialize;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::modelos::{archivo_valido, plan_whisper};

/// Detector de voz Silero (formato de whisper.cpp, MIT, ggml-org/whisper-vad): quita los silencios
/// de los audios largos antes de transcribir. Pesa menos de 1 MB, así que va dentro del APK.
static VAD: &[u8] = include_bytes!("../recursos/ggml-silero-v5.1.2.bin");

#[derive(Serialize, Default)]
pub struct Segmento {
    start: f32,
    end: f32,
    text: String,
}

/// Mismo formato que `TranscribeResult` en src/shared/ipc.ts.
#[derive(Serialize, Default)]
pub struct Transcripcion {
    text: String,
    segments: Vec<Segmento>,
    ms: u64,
}

pub struct Stt {
    dir: PathBuf,
    /// Carpeta propia de la app (el detector de voz se copia aquí la primera vez).
    motor_dir: PathBuf,
    /// Modelo cargado (nombre del archivo y contexto de whisper.cpp).
    motor: Mutex<Option<(String, WhisperContext)>>,
}

/// Hilos para la inferencia: los núcleos grandes de un teléfono típico (más hilos no aceleran).
fn hilos() -> i32 {
    std::thread::available_parallelism().map(|n| n.get().min(4) as i32).unwrap_or(4)
}

impl Stt {
    pub fn new(dir: PathBuf, motor_dir: PathBuf) -> Self {
        whisper_rs::install_logging_hooks();
        Self { dir, motor_dir, motor: Mutex::new(None) }
    }

    /// Ruta del detector de voz, copiándolo del APK si hace falta. None si no se pudo (se
    /// transcribe igual, sin quitar silencios).
    fn vad(&self) -> Option<String> {
        let ruta = self.motor_dir.join("ggml-silero-v5.1.2.bin");
        if fs::metadata(&ruta).map(|m| m.len() as usize).ok() != Some(VAD.len()) {
            fs::create_dir_all(&self.motor_dir).ok()?;
            let tmp = ruta.with_extension("tmp");
            fs::write(&tmp, VAD).ok()?;
            fs::rename(&tmp, &ruta).ok()?;
        }
        ruta.to_str().map(String::from)
    }

    fn cargar_en(&self, motor: &mut Option<(String, WhisperContext)>, modelo: &str) -> Result<(), String> {
        if motor.as_ref().is_some_and(|(m, _)| m == modelo) {
            return Ok(());
        }
        if modelo.is_empty() {
            return Err("Descarga un modelo de voz en Ajustes → Servicios de IA.".into());
        }
        if !archivo_valido(modelo) || !modelo.ends_with(".bin") {
            return Err(format!("Modelo de voz no válido: «{modelo}»."));
        }
        let ruta = self.dir.join(modelo);
        if !ruta.exists() {
            return Err(format!("El modelo «{modelo}» no está descargado. Descárgalo en Ajustes → Servicios de IA."));
        }
        *motor = None; // libera la memoria del anterior antes de cargar el nuevo
        let mut params = WhisperContextParameters::default();
        params.flash_attn(true);
        let ctx = WhisperContext::new_with_params(&ruta, params)
            .map_err(|e| format!("No se pudo cargar el modelo de voz: {e}"))?;
        *motor = Some((modelo.to_string(), ctx));
        Ok(())
    }

    /// Carga el modelo por adelantado (al empezar a grabar), para que la primera frase no espere.
    pub fn cargar(&self, modelo: &str) -> Result<(), String> {
        let mut motor = self.motor.lock().unwrap();
        self.cargar_en(&mut motor, modelo)
    }

    pub fn cargado(&self) -> Option<String> {
        self.motor.lock().unwrap().as_ref().map(|(m, _)| m.clone())
    }

    /// `prompt`: texto de arranque (estilo y palabras del diccionario) para que Whisper puntúe bien
    /// y escriba los nombres propios como el usuario.
    pub fn transcribir(&self, modelo: &str, pcm: &[f32], idioma: Option<&str>, marcas: bool, borrador: bool, prompt: &str) -> Result<Transcripcion, String> {
        let mut motor = if borrador {
            match self.motor.try_lock() {
                Ok(m) => m,
                Err(_) => return Ok(Transcripcion::default()),
            }
        } else {
            self.motor.lock().unwrap()
        };
        self.cargar_en(&mut motor, modelo)?;
        let vad = if borrador { None } else { self.vad() };
        let (_, ctx) = motor.as_ref().expect("modelo cargado");

        let t0 = Instant::now();
        let plan = plan_whisper(pcm.len(), marcas, borrador, vad.is_some());
        let mut estado = ctx.create_state().map_err(|e| format!("Whisper: {e}"))?;
        let estrategia = if plan.haz > 1 {
            SamplingStrategy::BeamSearch { beam_size: plan.haz, patience: -1.0 }
        } else {
            SamplingStrategy::Greedy { best_of: 1 }
        };
        let mut p = FullParams::new(estrategia);
        p.set_n_threads(hilos());
        // Ventana ajustada a la frase (mucho más rápido); con marcas de tiempo (subtítulos) se usa
        // la completa, porque la corta junta todo en un único segmento.
        if plan.ventana > 0 {
            p.set_audio_ctx(plan.ventana);
        }
        p.set_language(Some(idioma.unwrap_or("auto")));
        p.set_no_timestamps(!marcas);
        p.set_single_segment(!marcas);
        p.set_no_context(true);
        p.set_suppress_blank(true);
        // Sin «[Música]», «(aplausos)» ni similares: en un dictado nunca son texto.
        p.set_suppress_nst(true);
        // Si una ventana sale repetitiva o con poca confianza, se reintenta con algo de temperatura.
        p.set_temperature(0.0);
        p.set_temperature_inc(if borrador { 0.0 } else { 0.2 });
        p.set_no_speech_thold(0.6);
        // Con marcas de tiempo el texto de arranque (que no las lleva) hace que Whisper junte todo en
        // un segmento y se salte el resto del audio (medido en el teléfono): solo sin marcas.
        if !prompt.is_empty() && !borrador && !marcas {
            p.set_initial_prompt(prompt);
        }
        if let (true, Some(ruta)) = (plan.vad, vad.as_deref()) {
            p.set_vad_model_path(Some(ruta));
            p.enable_vad(true);
        }
        p.set_print_progress(false);
        p.set_print_realtime(false);
        p.set_print_special(false);
        p.set_print_timestamps(false);
        estado.full(p, pcm).map_err(|e| format!("Whisper: {e}"))?;

        let mut segments = Vec::new();
        for i in 0..estado.full_n_segments() {
            let Some(seg) = estado.get_segment(i) else { continue };
            let text = seg.to_str_lossy().map(|t| t.trim().to_string()).unwrap_or_default();
            if text.is_empty() {
                continue;
            }
            segments.push(Segmento { start: seg.start_timestamp() as f32 / 100.0, end: seg.end_timestamp() as f32 / 100.0, text });
        }
        let text = segments.iter().map(|s| s.text.as_str()).collect::<Vec<_>>().join(" ");
        Ok(Transcripcion { text, segments, ms: t0.elapsed().as_millis() as u64 })
    }
}
