//! Descarga de modelos de IA al teléfono: reanudable, cancelable y verificada con SHA-256.
//!
//! Cada descarga corre en su hilo y avisa a la interfaz con el evento `models:progress`
//! (`LocalModelProgress` en src/shared/local-models.ts). El archivo se escribe como `<nombre>.part`
//! y solo se renombra al nombre final cuando el tamaño y la huella coinciden; si se corta la red o
//! se cierra la app, la siguiente descarga continúa donde se quedó (cabecera Range).

use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::modelos::{archivo_valido, espacio_necesario, sha256_archivo, Pedido};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progreso<'a> {
    id: &'a str,
    state: &'a str,
    received: u64,
    total: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

/// Un modelo presente en el teléfono (completo o a medias).
#[derive(Serialize)]
pub struct ArchivoModelo {
    id: String,
    bytes: u64,
    partial: bool,
}

pub struct Descargas {
    dir: PathBuf,
    /// Descargas en curso, con su señal de cancelación.
    activas: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl Descargas {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir, activas: Mutex::new(HashMap::new()) }
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// Modelos en la carpeta: los completos y los `.part` que se pueden reanudar.
    pub fn listar(&self) -> Vec<ArchivoModelo> {
        let Ok(entradas) = fs::read_dir(&self.dir) else { return Vec::new() };
        let mut lista: Vec<ArchivoModelo> = entradas
            .flatten()
            .filter_map(|e| {
                let nombre = e.file_name().into_string().ok()?;
                let bytes = e.metadata().ok()?.len();
                match nombre.strip_suffix(".part") {
                    Some(id) if archivo_valido(id) => Some(ArchivoModelo { id: id.to_string(), bytes, partial: true }),
                    None if archivo_valido(&nombre) => Some(ArchivoModelo { id: nombre, bytes, partial: false }),
                    _ => None,
                }
            })
            .collect();
        lista.sort_by(|a, b| a.id.cmp(&b.id));
        lista
    }

    pub fn borrar(&self, id: &str) -> Result<(), String> {
        if !archivo_valido(id) {
            return Err(format!("Nombre de modelo no válido: «{id}»."));
        }
        self.cancelar(id);
        for ruta in [self.dir.join(id), self.dir.join(format!("{id}.part"))] {
            if ruta.exists() {
                fs::remove_file(&ruta).map_err(|e| format!("No se pudo borrar {}: {e}", ruta.display()))?;
            }
        }
        Ok(())
    }

    pub fn cancelar(&self, id: &str) {
        if let Some(señal) = self.activas.lock().unwrap().get(id) {
            señal.store(true, Ordering::Relaxed);
        }
    }

    /// Empieza (o reanuda) una descarga en otro hilo. Si ya está en curso, no hace nada.
    pub fn iniciar(self: &Arc<Self>, app: AppHandle, pedido: Pedido) {
        let señal = Arc::new(AtomicBool::new(false));
        {
            let mut activas = self.activas.lock().unwrap();
            if activas.contains_key(&pedido.archivo) {
                return;
            }
            activas.insert(pedido.archivo.clone(), señal.clone());
        }
        let yo = self.clone();
        std::thread::spawn(move || {
            let id = pedido.archivo.clone();
            let avisar = |state: &str, received: u64, error: Option<String>| {
                let _ = app.emit("models:progress", Progreso { id: &id, state, received, total: pedido.bytes, error });
            };
            match yo.descargar(&pedido, &señal, &avisar) {
                Ok(()) => avisar("done", pedido.bytes, None),
                Err(_) if señal.load(Ordering::Relaxed) => avisar("cancelled", 0, None),
                Err(e) => avisar("error", 0, Some(e)),
            }
            yo.activas.lock().unwrap().remove(&id);
        });
    }

    fn descargar(&self, p: &Pedido, cancelado: &AtomicBool, avisar: &dyn Fn(&str, u64, Option<String>)) -> Result<(), String> {
        fs::create_dir_all(&self.dir).map_err(|e| format!("No se pudo crear la carpeta de modelos: {e}"))?;
        let final_ = self.dir.join(&p.archivo);
        if fs::metadata(&final_).is_ok_and(|m| m.len() == p.bytes) {
            return Ok(());
        }
        let parte = self.dir.join(format!("{}.part", p.archivo));
        let mut desde = fs::metadata(&parte).map(|m| m.len()).unwrap_or(0);
        if desde > p.bytes {
            desde = 0;
        }

        let libre = espacio_libre(&self.dir).unwrap_or(u64::MAX);
        let falta = espacio_necesario(p.bytes, desde);
        if libre < falta {
            return Err(format!(
                "No hay espacio suficiente: hacen falta {} MB y quedan {} MB libres.",
                falta / 1_000_000,
                libre / 1_000_000
            ));
        }

        if desde < p.bytes {
            let agente: ureq::Agent = ureq::Agent::config_builder()
                .timeout_connect(Some(Duration::from_secs(30)))
                .timeout_recv_response(Some(Duration::from_secs(60)))
                .user_agent("DictaFlow-Android")
                .build()
                .into();
            let mut pedido = agente.get(p.url.as_str());
            if desde > 0 {
                pedido = pedido.header("Range", format!("bytes={desde}-"));
            }
            let mut respuesta = pedido.call().map_err(|e| format!("No se pudo conectar con Hugging Face: {e}"))?;
            // 206: el servidor continúa donde se quedó. 200: manda el archivo entero (se empieza de cero).
            let reanuda = respuesta.status().as_u16() == 206;
            if !reanuda {
                desde = 0;
            }
            let mut archivo = OpenOptions::new()
                .create(true)
                .write(true)
                .append(reanuda)
                .truncate(!reanuda)
                .open(&parte)
                .map_err(|e| format!("No se pudo escribir el modelo: {e}"))?;
            let mut lector = respuesta.body_mut().as_reader();
            let mut buf = vec![0u8; 256 * 1024];
            let mut recibido = desde;
            let mut ultimo_aviso = Instant::now() - Duration::from_secs(1);
            loop {
                if cancelado.load(Ordering::Relaxed) {
                    return Err("cancelado".into());
                }
                let n = lector.read(&mut buf).map_err(|e| format!("Se cortó la descarga: {e}. Vuelve a intentarlo; continuará donde se quedó."))?;
                if n == 0 {
                    break;
                }
                archivo.write_all(&buf[..n]).map_err(|e| format!("No se pudo escribir el modelo: {e}"))?;
                recibido += n as u64;
                if ultimo_aviso.elapsed() >= Duration::from_millis(400) {
                    avisar("downloading", recibido, None);
                    ultimo_aviso = Instant::now();
                }
            }
            archivo.sync_all().map_err(|e| format!("No se pudo guardar el modelo: {e}"))?;
            if recibido != p.bytes {
                return Err(format!("La descarga llegó incompleta ({recibido} de {} bytes). Vuelve a intentarlo.", p.bytes));
            }
        }

        avisar("verifying", p.bytes, None);
        let huella = sha256_archivo(&parte).map_err(|e| format!("No se pudo verificar el modelo: {e}"))?;
        if huella != p.sha256 {
            let _ = fs::remove_file(&parte);
            return Err("El archivo descargado no coincide con su huella SHA-256; se borró. Vuelve a descargarlo.".into());
        }
        fs::rename(&parte, &final_).map_err(|e| format!("No se pudo guardar el modelo: {e}"))
    }
}

/// Bytes libres en la partición de la carpeta dada.
pub fn espacio_libre(dir: &Path) -> Option<u64> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let existente = dir.ancestors().find(|d| d.exists())?;
    let ruta = CString::new(existente.as_os_str().as_bytes()).ok()?;
    let mut st: libc::statvfs = unsafe { std::mem::zeroed() };
    // SAFETY: `ruta` es una cadena C válida y `st` una estructura del tamaño correcto.
    if unsafe { libc::statvfs(ruta.as_ptr(), &mut st) } != 0 {
        return None;
    }
    #[allow(clippy::unnecessary_cast)]
    Some(st.f_bavail as u64 * st.f_frsize as u64)
}
