//! Voz → texto con whisper.cpp dentro de la app (whisper-rs).
//!
//! El modelo (GGML, descargado en Ajustes → Servicios de IA) se carga una vez y se reutiliza.
//! Igual que en escritorio (`src/main/stt-queue.ts`), la frase definitiva nunca espera a un
//! borrador: si el motor está ocupado, el borrador se omite (devuelve texto vacío) en vez de hacer
//! cola delante de la frase que importa.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;

use serde::Serialize;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::modelos::{archivo_valido, contexto_audio};

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
    /// Modelo cargado (nombre del archivo y contexto de whisper.cpp).
    motor: Mutex<Option<(String, WhisperContext)>>,
}

/// Hilos para la inferencia: los núcleos grandes de un teléfono típico (más hilos no aceleran).
fn hilos() -> i32 {
    std::thread::available_parallelism().map(|n| n.get().min(4) as i32).unwrap_or(4)
}

impl Stt {
    pub fn new(dir: PathBuf) -> Self {
        whisper_rs::install_logging_hooks();
        Self { dir, motor: Mutex::new(None) }
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

    pub fn transcribir(&self, modelo: &str, pcm: &[f32], idioma: Option<&str>, marcas: bool, borrador: bool) -> Result<Transcripcion, String> {
        let mut motor = if borrador {
            match self.motor.try_lock() {
                Ok(m) => m,
                Err(_) => return Ok(Transcripcion::default()),
            }
        } else {
            self.motor.lock().unwrap()
        };
        self.cargar_en(&mut motor, modelo)?;
        let (_, ctx) = motor.as_ref().expect("modelo cargado");

        let t0 = Instant::now();
        let mut estado = ctx.create_state().map_err(|e| format!("Whisper: {e}"))?;
        let mut p = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        p.set_n_threads(hilos());
        // Ventana ajustada a la frase (mucho más rápido); con marcas de tiempo (subtítulos) se usa
        // la completa, porque la corta junta todo en un único segmento.
        if !marcas {
            p.set_audio_ctx(contexto_audio(pcm.len()));
        }
        p.set_language(Some(idioma.unwrap_or("auto")));
        p.set_no_timestamps(!marcas);
        p.set_single_segment(!marcas);
        p.set_no_context(true);
        p.set_suppress_blank(true);
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
