//! DictaFlow para Android (Tauri 2).
//!
//! La interfaz es la misma app React del escritorio (`src/renderer`), empaquetada dentro del APK y
//! servida desde `https://tauri.localhost`. Su `window.api` (src/renderer/src/platform/tauri.ts)
//! llama a los comandos de este módulo. Aquí:
//!   • se crea la ventana con una política de navegación: solo la interfaz empaquetada se abre
//!     dentro de la app; cualquier enlace (web, mapas, WhatsApp, tel:, correo) va a la aplicación
//!     del sistema;
//!   • se guardan los documentos (ajustes, historial, prompts…) y las claves de API;
//!   • se descargan, verifican y borran los modelos de IA locales (descargas.rs);
//!   • se transcribe la voz con Whisper dentro del teléfono (stt.rs);
//!   • se redacta con un LLM (llama.cpp) dentro del teléfono (llm.rs);
//!   • se leen textos en voz alta con voces Piper (sherpa-onnx) dentro del teléfono (tts.rs);
//!   • se guardan los archivos propios (audio de reuniones, audiolibros…) y se exportan con el
//!     selector de archivos de Android (archivos.rs);
//!   • se programan los avisos de la agenda como notificaciones de Android;
//!   • se fija el servidor de actualizaciones y se abre la descarga del APK nuevo.
//! Ninguna página remota tiene acceso a estos comandos (capabilities/default.json, `local: true`).

use std::sync::{Arc, Mutex};

use base64::Engine as _;
use serde_json::Value;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_fs::FsExt;
use tauri_plugin_notification::{NotificationExt, PermissionState, Schedule};
use tauri_plugin_opener::OpenerExt;

mod almacen;
mod archivos;
mod descargas;
mod llm;
mod modelos;
mod politica;
mod stt;
mod tts;

use almacen::{Almacen, Documento};
use archivos::{Archivos, Entrada};
use descargas::{espacio_libre, ArchivoModelo, Descargas};
use llm::{Llm, Mensaje, Respuesta};
use stt::{Stt, Transcripcion};
use tts::Tts;
use politica::{descarga_permitida, navegacion_interna, origen_valido, SERVIDOR_PREDETERMINADO};

/// Datos de la app (ajustes, colecciones…) en la carpeta privada de la app.
struct Datos(Almacen);
/// Claves de API: en otra carpeta y sin comando de lectura; la interfaz solo puede saber si existen.
struct Secretos(Almacen);
/// Origen (esquema://host:puerto) del servidor de actualizaciones de confianza.
struct Servidor(Mutex<String>);

const SECRETOS: &[&str] = &["anthropic", "openai-compat", "openai-audio"];

#[tauri::command]
fn doc_get(name: String, datos: tauri::State<'_, Datos>) -> Result<Option<Documento>, String> {
    datos.0.leer(&name)
}

#[tauri::command]
fn doc_set(name: String, data: Value, datos: tauri::State<'_, Datos>) -> Result<(), String> {
    datos.0.escribir(&name, data)
}

#[tauri::command]
fn doc_remove(name: String, datos: tauri::State<'_, Datos>) -> Result<(), String> {
    datos.0.borrar(&name)
}

#[tauri::command]
fn doc_list(datos: tauri::State<'_, Datos>) -> Vec<String> {
    datos.0.listar()
}

#[tauri::command]
fn secret_set(name: String, value: String, secretos: tauri::State<'_, Secretos>) -> Result<(), String> {
    if !SECRETOS.contains(&name.as_str()) {
        return Err(format!("Clave desconocida: {name}"));
    }
    let mut todos = secretos.0.leer("secretos")?.map(|d| d.data).unwrap_or_else(|| Value::Object(Default::default()));
    let mapa = todos.as_object_mut().ok_or("Archivo de claves dañado.")?;
    if value.trim().is_empty() {
        mapa.remove(&name);
    } else {
        mapa.insert(name, Value::String(value.trim().to_string()));
    }
    secretos.0.escribir("secretos", todos)
}

#[tauri::command]
fn secret_has(name: String, secretos: tauri::State<'_, Secretos>) -> Result<bool, String> {
    Ok(secretos.0.leer("secretos")?.is_some_and(|d| d.data.get(&name).and_then(Value::as_str).is_some_and(|v| !v.is_empty())))
}

/// Lo que el teléfono necesita saber para elegir modelos: RAM, espacio libre y núcleos.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Equipo {
    ram_bytes: u64,
    free_bytes: u64,
    cores: usize,
}

#[tauri::command]
fn device_info(descargas: tauri::State<'_, Arc<Descargas>>) -> Equipo {
    // MemTotal en /proc/meminfo (kB): el WebView limita navigator.deviceMemory a 8.
    let ram_kb = std::fs::read_to_string("/proc/meminfo")
        .ok()
        .and_then(|t| t.lines().find(|l| l.starts_with("MemTotal:")).and_then(|l| l.split_whitespace().nth(1)?.parse::<u64>().ok()))
        .unwrap_or(0);
    Equipo {
        ram_bytes: ram_kb * 1024,
        free_bytes: espacio_libre(descargas.dir()).unwrap_or(0),
        cores: std::thread::available_parallelism().map(|n| n.get()).unwrap_or(0),
    }
}

#[tauri::command]
fn models_list(descargas: tauri::State<'_, Arc<Descargas>>) -> Vec<ArchivoModelo> {
    descargas.listar()
}

#[tauri::command]
fn models_download(
    url: String,
    id: String,
    bytes: u64,
    sha256: String,
    app: tauri::AppHandle,
    descargas: tauri::State<'_, Arc<Descargas>>,
) -> Result<(), String> {
    let pedido = modelos::validar_pedido(&url, &id, bytes, &sha256)?;
    descargas.iniciar(app, pedido);
    Ok(())
}

#[tauri::command]
fn models_cancel(id: String, descargas: tauri::State<'_, Arc<Descargas>>) {
    descargas.cancelar(&id);
}

#[tauri::command]
fn models_remove(id: String, descargas: tauri::State<'_, Arc<Descargas>>, tts: tauri::State<'_, Arc<Tts>>) -> Result<(), String> {
    if let Some(voz) = id.strip_suffix(".onnx.json").or_else(|| id.strip_suffix(".onnx")) {
        tts.olvidar(voz);
    }
    descargas.borrar(&id)
}

/// Precarga el modelo de voz (en otro hilo: cargar small tarda unos segundos).
#[tauri::command]
async fn stt_load(model: String, stt: tauri::State<'_, Arc<Stt>>) -> Result<(), String> {
    let stt = stt.inner().clone();
    tauri::async_runtime::spawn_blocking(move || stt.cargar(&model)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn stt_loaded(stt: tauri::State<'_, Arc<Stt>>) -> Option<String> {
    stt.cargado()
}

/// Transcribe audio PCM (16 kHz, mono). El audio llega como cuerpo binario (Float32Array) y los
/// parámetros en cabeceras: `x-model`, `x-lang`, `x-priority` (final|draft) y `x-timestamps`.
#[tauri::command]
async fn stt_transcribe(request: tauri::ipc::Request<'_>, stt: tauri::State<'_, Arc<Stt>>) -> Result<Transcripcion, String> {
    // Con el IPC por protocolo propio llega crudo; con el de postMessage (Android), como lista JSON.
    let pcm = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => modelos::pcm_desde_bytes(bytes)?,
        tauri::ipc::InvokeBody::Json(Value::Array(lista)) => {
            let bytes: Vec<u8> = lista.iter().map(|v| v.as_u64().filter(|n| *n <= 255).map(|n| n as u8)).collect::<Option<_>>().ok_or("Audio dañado.")?;
            modelos::pcm_desde_bytes(&bytes)?
        }
        _ => return Err("El audio debe llegar como datos binarios.".into()),
    };
    let cabecera = |n: &str| request.headers().get(n).and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let modelo = cabecera("x-model");
    let idioma = modelos::idioma_whisper(&cabecera("x-lang"))?;
    let borrador = cabecera("x-priority") == "draft";
    let marcas = cabecera("x-timestamps") == "1";
    let stt = stt.inner().clone();
    tauri::async_runtime::spawn_blocking(move || stt.transcribir(&modelo, &pcm, idioma.as_deref(), marcas, borrador))
        .await
        .map_err(|e| e.to_string())?
}

/// Precarga el modelo de redacción (cargar 1–2 GB tarda unos segundos la primera vez).
#[tauri::command]
async fn llm_load(model: String, llm: tauri::State<'_, Arc<Llm>>) -> Result<(), String> {
    let llm = llm.inner().clone();
    tauri::async_runtime::spawn_blocking(move || llm.cargar(&model)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn llm_loaded(llm: tauri::State<'_, Arc<Llm>>) -> Option<String> {
    llm.cargado()
}

/// Respuesta del modelo local a una conversación. Los prompts los arma la interfaz
/// (`src/shared/llm-tasks.ts`, los mismos que en escritorio).
#[tauri::command]
async fn llm_complete(
    model: String,
    system: String,
    msgs: Vec<Mensaje>,
    temperature: f32,
    llm: tauri::State<'_, Arc<Llm>>,
) -> Result<Respuesta, String> {
    let llm = llm.inner().clone();
    tauri::async_runtime::spawn_blocking(move || llm.completar(&model, &system, &msgs, temperature))
        .await
        .map_err(|e| e.to_string())?
}

/// Lee un texto con una voz descargada. Devuelve un WAV como datos binarios (no como lista JSON).
#[tauri::command]
async fn tts_synth(voice: String, text: String, speed: f32, tts: tauri::State<'_, Arc<Tts>>) -> Result<tauri::ipc::Response, String> {
    let tts = tts.inner().clone();
    let wav = tauri::async_runtime::spawn_blocking(move || tts.sintetizar(&voice, &text, speed))
        .await
        .map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(wav))
}

/// Muestra oficial de una voz (MP3 corto), para escucharla antes de descargarla. No se guarda.
#[tauri::command]
async fn tts_sample(url: String) -> Result<tauri::ipc::Response, String> {
    let url = modelos::url_muestra(&url)?;
    let mp3 = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let mut r = ureq::get(url.as_str()).call().map_err(|e| format!("No se pudo descargar la muestra: {e}"))?;
        r.body_mut().with_config().limit(5 * 1024 * 1024).read_to_vec().map_err(|e| format!("No se pudo descargar la muestra: {e}"))
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(mp3))
}

// ── Archivos propios de la app ─────────────────────────────────────────────────────────────
/// Lo que llega de la interfaz va en base64: con el IPC de Android, los datos binarios viajan como
/// una lista JSON de números, mucho más lenta.
fn base64(datos: &str) -> Result<Vec<u8>, String> {
    base64::engine::general_purpose::STANDARD.decode(datos).map_err(|_| "Datos dañados.".to_string())
}

#[tauri::command]
fn file_write(path: String, data: String, append: bool, archivos: tauri::State<'_, Arc<Archivos>>) -> Result<(), String> {
    archivos.escribir(&path, &base64(&data)?, append)
}

#[tauri::command]
async fn file_read(path: String, archivos: tauri::State<'_, Arc<Archivos>>) -> Result<tauri::ipc::Response, String> {
    let archivos = archivos.inner().clone();
    let datos = tauri::async_runtime::spawn_blocking(move || archivos.leer(&path)).await.map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(datos))
}

#[tauri::command]
fn file_remove(path: String, archivos: tauri::State<'_, Arc<Archivos>>) -> Result<(), String> {
    archivos.borrar(&path)
}

#[tauri::command]
fn file_list(dir: String, archivos: tauri::State<'_, Arc<Archivos>>) -> Result<Vec<Entrada>, String> {
    archivos.listar(&dir)
}

#[tauri::command]
async fn file_join(parts: Vec<String>, dest: String, archivos: tauri::State<'_, Arc<Archivos>>) -> Result<(), String> {
    let archivos = archivos.inner().clone();
    tauri::async_runtime::spawn_blocking(move || archivos.unir(&parts, &dest)).await.map_err(|e| e.to_string())?
}

/// Termina un WAV escrito por partes (grabación de una reunión) y devuelve su duración.
#[tauri::command]
fn wav_close(path: String, archivos: tauri::State<'_, Arc<Archivos>>) -> Result<f64, String> {
    archivos.cerrar_wav(&path)
}

/// Guarda en el teléfono (Descargas, Drive…, lo que elija el usuario en el selector de Android)
/// unos datos (`data`, base64) o un archivo propio de la app (`path`). Devuelve el nombre con que
/// se ofreció, o `None` si el usuario canceló.
#[tauri::command]
async fn save_as(
    name: String,
    ext: String,
    data: Option<String>,
    path: Option<String>,
    app: tauri::AppHandle,
    archivos: tauri::State<'_, Arc<Archivos>>,
) -> Result<Option<String>, String> {
    if ext.is_empty() || ext.len() > 8 || !ext.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return Err(format!("Extensión no válida: «{ext}»."));
    }
    let sugerido = archivos::nombre_sugerido(&name, &ext);
    let origen = match (data, path) {
        (Some(d), None) => Ok(base64(&d)?),
        (None, Some(p)) => Err(archivos.ruta(&p)?),
        _ => return Err("Indica qué guardar.".into()),
    };
    tauri::async_runtime::spawn_blocking(move || -> Result<Option<String>, String> {
        let Some(destino) = app.dialog().file().set_file_name(&sugerido).add_filter(ext.to_uppercase(), &[&ext]).blocking_save_file() else {
            return Ok(None);
        };
        let mut opciones = tauri_plugin_fs::OpenOptions::new();
        opciones.write(true).truncate(true).create(true);
        let mut salida = app.fs().open(destino, opciones).map_err(|e| format!("No se pudo guardar: {e}"))?;
        match origen {
            Ok(bytes) => std::io::Write::write_all(&mut salida, &bytes),
            Err(ruta) => std::fs::File::open(&ruta).and_then(|mut f| std::io::copy(&mut f, &mut salida).map(|_| ())),
        }
        .and_then(|_| salida.sync_all())
        .map_err(|e| format!("No se pudo guardar: {e}"))?;
        Ok(Some(sugerido))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Espacio que ocupa cada parte de los datos de la app, en bytes.
#[derive(serde::Serialize)]
struct Uso {
    datos: u64,
    modelos: u64,
    archivos: u64,
    libres: u64,
}

#[tauri::command]
fn storage_usage(app: tauri::AppHandle) -> Result<Uso, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    Ok(Uso {
        datos: archivos::tamano(&base.join("datos")),
        modelos: archivos::tamano(&base.join("modelos")),
        archivos: archivos::tamano(&base.join("archivos")),
        libres: espacio_libre(&base).unwrap_or(0),
    })
}

// ── Avisos de la agenda ────────────────────────────────────────────────────────────────────
/// Programa un aviso (recordatorio o evento) como notificación de Android: suena aunque la app
/// esté cerrada. Pide el permiso de notificaciones la primera vez; devuelve `false` si se niega.
#[tauri::command]
async fn notice_schedule(id: i32, title: String, body: String, at: i64, app: tauri::AppHandle) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<bool, String> {
        let n = app.notification();
        let mut estado = n.permission_state().map_err(|e| e.to_string())?;
        if estado != PermissionState::Granted {
            estado = n.request_permission().map_err(|e| e.to_string())?;
        }
        if estado != PermissionState::Granted {
            return Ok(false);
        }
        let fecha = time::OffsetDateTime::from_unix_timestamp_nanos(at as i128 * 1_000_000).map_err(|e| e.to_string())?;
        n.builder()
            .id(id)
            .title(title)
            .body(body)
            .schedule(Schedule::At { date: fecha, repeating: false, allow_while_idle: true })
            .show()
            .map_err(|e| e.to_string())?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn notice_cancel(ids: Vec<i32>, app: tauri::AppHandle) -> Result<(), String> {
    app.notification().cancel(ids).map_err(|e| e.to_string())
}

/// Cambia el servidor de actualizaciones (se valida aquí, no en JavaScript) y lo recuerda.
#[tauri::command]
fn fijar_servidor(url: String, estado: tauri::State<'_, Servidor>, datos: tauri::State<'_, Datos>) -> Result<String, String> {
    let origen = origen_valido(&url)?;
    datos.0.escribir("servidor", Value::String(origen.clone()))?;
    *estado.0.lock().unwrap() = origen.clone();
    Ok(origen)
}

#[tauri::command]
fn servidor(estado: tauri::State<'_, Servidor>) -> String {
    estado.0.lock().unwrap().clone()
}

/// Abre la descarga del APK nuevo con el navegador del sistema (Android pide confirmar la
/// instalación). Solo acepta la ruta de descarga del servidor de confianza.
#[tauri::command]
fn abrir_actualizacion(url: String, app: tauri::AppHandle, estado: tauri::State<'_, Servidor>) -> Result<(), String> {
    let servidor = estado.0.lock().unwrap().clone();
    let destino = descarga_permitida(&url, &servidor)?;
    app.opener().open_url(destino.as_str(), None::<&str>).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            doc_get,
            doc_set,
            doc_remove,
            doc_list,
            secret_set,
            secret_has,
            device_info,
            models_list,
            models_download,
            models_cancel,
            models_remove,
            stt_load,
            stt_loaded,
            stt_transcribe,
            llm_load,
            llm_loaded,
            llm_complete,
            tts_synth,
            tts_sample,
            file_write,
            file_read,
            file_remove,
            file_list,
            file_join,
            wav_close,
            save_as,
            storage_usage,
            notice_schedule,
            notice_cancel,
            fijar_servidor,
            servidor,
            abrir_actualizacion
        ])
        .setup(|app| {
            let base = app.path().app_data_dir()?;
            let datos = Almacen::new(base.join("datos"));
            let guardado = datos.leer("servidor").ok().flatten().and_then(|d| d.data.as_str().map(String::from));
            let origen = guardado.and_then(|s| origen_valido(&s).ok()).unwrap_or_else(|| SERVIDOR_PREDETERMINADO.to_string());
            app.manage(Datos(datos));
            app.manage(Secretos(Almacen::new(base.join("privado"))));
            app.manage(Arc::new(Descargas::new(base.join("modelos"))));
            app.manage(Arc::new(Stt::new(base.join("modelos"))));
            app.manage(Arc::new(Llm::new(base.join("modelos"))?));
            app.manage(Arc::new(Tts::new(base.join("modelos"), base.join("voz"))));
            app.manage(Arc::new(Archivos::new(base.join("archivos"))));
            app.manage(Servidor(Mutex::new(origen)));

            let handle = app.handle().clone();
            // https://tauri.localhost: el micrófono (getUserMedia) solo funciona en un origen seguro.
            let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .use_https_scheme(true)
                .on_navigation(move |url| {
                    if navegacion_interna(url) {
                        return true;
                    }
                    // Enlace externo: lo abre la aplicación del sistema (Chrome, Maps, WhatsApp…).
                    // Fuera del hilo de la interfaz: el plugin de Android no responde si se llama desde aquí.
                    let (h, destino) = (handle.clone(), url.to_string());
                    std::thread::spawn(move || {
                        if let Err(e) = h.opener().open_url(destino, None::<&str>) {
                            eprintln!("no se pudo abrir el enlace externo: {e}");
                        }
                    });
                    false
                });
            #[cfg(desktop)]
            let builder = builder.title("DictaFlow").inner_size(420.0, 860.0);
            #[cfg(feature = "depuracion")]
            let builder = builder.devtools(true);
            builder.build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("no fue posible iniciar DictaFlow");
}
