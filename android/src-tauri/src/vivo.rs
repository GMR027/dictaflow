//! Texto en vivo: un modelo *streaming* (zipformer transducer de Kroko, sherpa-onnx) que escribe lo
//! que dices palabra a palabra mientras hablas, como el dictado de Google.
//!
//! Solo pinta el texto provisional: cuando la frase se cierra, Whisper (stt.rs) da el texto
//! definitivo, con puntuación y mayúsculas. Usa 2 hilos para dejar el resto a Whisper.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use sherpa_onnx::{OnlineModelConfig, OnlineRecognizer, OnlineRecognizerConfig, OnlineStream, OnlineTransducerModelConfig};

use crate::modelos::archivos_vivo;

struct Sesion {
    rec: Arc<OnlineRecognizer>,
    flujo: OnlineStream,
    /// Texto de los tramos ya cerrados por el propio modelo (pausas largas dentro de una frase).
    previo: String,
}

#[derive(Serialize)]
pub struct Parcial {
    texto: String,
}

pub struct Vivo {
    dir: PathBuf,
    motor: Mutex<Option<(String, Arc<OnlineRecognizer>)>>,
    sesiones: Mutex<HashMap<u32, Arc<Mutex<Sesion>>>>,
    siguiente: AtomicU32,
}

impl Vivo {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir, motor: Mutex::new(None), sesiones: Mutex::new(HashMap::new()), siguiente: AtomicU32::new(1) }
    }

    fn reconocedor(&self, modelo: &str) -> Result<Arc<OnlineRecognizer>, String> {
        let mut motor = self.motor.lock().unwrap();
        if let Some((m, rec)) = motor.as_ref() {
            if m == modelo {
                return Ok(rec.clone());
            }
        }
        let archivos = archivos_vivo(modelo).ok_or_else(|| format!("Modelo de texto en vivo no válido: «{modelo}»."))?;
        let rutas: Vec<String> = archivos.iter().map(|a| self.dir.join(a)).map(|p| p.to_string_lossy().into_owned()).collect();
        if !archivos.iter().all(|a| self.dir.join(a).is_file()) {
            return Err("Falta descargar el modelo de texto en vivo (Ajustes → Servicios de IA).".into());
        }
        *motor = None; // libera el anterior antes de cargar otro
        let mut cfg = OnlineRecognizerConfig::default();
        cfg.model_config = OnlineModelConfig {
            transducer: OnlineTransducerModelConfig { encoder: Some(rutas[0].clone()), decoder: Some(rutas[1].clone()), joiner: Some(rutas[2].clone()) },
            tokens: Some(rutas[3].clone()),
            num_threads: 2,
            provider: Some("cpu".into()),
            ..Default::default()
        };
        cfg.decoding_method = Some("greedy_search".into());
        // El propio modelo cierra tramos tras una pausa: así el flujo no crece sin fin si la interfaz
        // tarda en cerrar la frase.
        cfg.enable_endpoint = true;
        cfg.rule1_min_trailing_silence = 2.4;
        cfg.rule2_min_trailing_silence = 1.0;
        cfg.rule3_min_utterance_length = 25.0;
        let rec = Arc::new(OnlineRecognizer::create(&cfg).ok_or("No se pudo cargar el modelo de texto en vivo. Bórralo y vuelve a descargarlo.")?);
        *motor = Some((modelo.to_string(), rec.clone()));
        Ok(rec)
    }

    /// Abre una sesión (carga el modelo la primera vez). Devuelve su número.
    pub fn iniciar(&self, modelo: &str) -> Result<u32, String> {
        let rec = self.reconocedor(modelo)?;
        let flujo = rec.create_stream();
        let id = self.siguiente.fetch_add(1, Ordering::Relaxed);
        self.sesiones.lock().unwrap().insert(id, Arc::new(Mutex::new(Sesion { rec, flujo, previo: String::new() })));
        Ok(id)
    }

    fn sesion(&self, id: u32) -> Result<Arc<Mutex<Sesion>>, String> {
        self.sesiones.lock().unwrap().get(&id).cloned().ok_or_else(|| "La sesión de texto en vivo ya terminó.".into())
    }

    /// Añade audio (16 kHz) y devuelve el texto provisional de la frase en curso.
    pub fn alimentar(&self, id: u32, pcm: &[f32]) -> Result<Parcial, String> {
        let s = self.sesion(id)?;
        let mut s = s.lock().unwrap();
        s.flujo.accept_waveform(16_000, pcm);
        while s.rec.is_ready(&s.flujo) {
            s.rec.decode(&s.flujo);
        }
        let actual = s.rec.get_result(&s.flujo).map(|r| r.text.trim().to_string()).unwrap_or_default();
        if s.rec.is_endpoint(&s.flujo) {
            if !actual.is_empty() {
                s.previo = format!("{} {actual}", s.previo).trim().to_string();
            }
            s.rec.reset(&s.flujo);
            return Ok(Parcial { texto: s.previo.clone() });
        }
        Ok(Parcial { texto: format!("{} {actual}", s.previo).trim().to_string() })
    }

    /// La frase se cerró (la interfaz ya la mandó a Whisper): empieza una nueva.
    pub fn reiniciar(&self, id: u32) -> Result<(), String> {
        let s = self.sesion(id)?;
        let mut s = s.lock().unwrap();
        s.rec.reset(&s.flujo);
        s.previo.clear();
        Ok(())
    }

    pub fn terminar(&self, id: u32) {
        self.sesiones.lock().unwrap().remove(&id);
    }
}
