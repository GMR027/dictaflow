//! Lectura en voz alta dentro del teléfono: voces Piper con sherpa-onnx (onnxruntime + espeak-ng).
//!
//! Las voces son las de escritorio, en la copia preparada para sherpa-onnx; se descargan en
//! `modelos/` como `<voz>.onnx` y `<voz>.onnx.json` (src/shared/local-models.ts). La tabla de
//! fonemas que pide sherpa-onnx (`tokens.txt`) se escribe a partir del `.onnx.json`, y los datos de
//! espeak-ng (cómo se pronuncia cada palabra en español e inglés) van dentro de la app.
//!
//! La voz se queda cargada entre frases (cargarla tarda ~1 s); se atiende una petición a la vez.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use sherpa_onnx::{GenerationConfig, OfflineTts, OfflineTtsConfig, OfflineTtsModelConfig, OfflineTtsVitsModelConfig};

use crate::modelos::{tokens_piper, velocidad_voz, voz_valida, wav_pcm16};

/// Datos de espeak-ng para es/en (android/herramientas/espeak-ng-data.py).
static ESPEAK: &[u8] = include_bytes!("../recursos/espeak-ng-data.tar");

pub struct Tts {
    modelos: PathBuf,
    /// Carpeta propia: datos de espeak-ng y tablas de fonemas.
    dir: PathBuf,
    motor: Mutex<Option<(String, OfflineTts)>>,
}

fn hilos() -> i32 {
    std::thread::available_parallelism().map(|n| n.get().min(4)).unwrap_or(2) as i32
}

impl Tts {
    pub fn new(modelos: PathBuf, dir: PathBuf) -> Self {
        Self { modelos, dir, motor: Mutex::new(None) }
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

    /// Lee `texto` con la voz `voz` y devuelve un WAV.
    pub fn sintetizar(&self, voz: &str, texto: &str, velocidad: f32) -> Result<Vec<u8>, String> {
        if !voz_valida(voz) {
            return Err(format!("Voz no válida: «{voz}»."));
        }
        let texto = texto.split_whitespace().collect::<Vec<_>>().join(" ");
        if texto.is_empty() {
            return Err("No hay texto que leer.".into());
        }
        let mut motor = self.motor.lock().unwrap();
        if motor.as_ref().is_none_or(|(id, _)| id != voz) {
            // Se libera la anterior antes de cargar otra.
            *motor = None;
            *motor = Some((voz.to_string(), self.cargar(voz)?));
        }
        let (_, tts) = motor.as_ref().expect("voz cargada");
        let opciones = GenerationConfig { speed: velocidad_voz(velocidad), sid: 0, ..Default::default() };
        let audio = tts
            .generate_with_config(&texto, &opciones, None::<fn(&[f32], f32) -> bool>)
            .ok_or("La voz no pudo leer este texto.")?;
        Ok(wav_pcm16(audio.samples(), audio.sample_rate() as u32))
    }

    /// Libera la voz cargada si se borra su archivo.
    pub fn olvidar(&self, voz: &str) {
        let mut motor = self.motor.lock().unwrap();
        if motor.as_ref().is_some_and(|(id, _)| id == voz) {
            *motor = None;
        }
    }
}
