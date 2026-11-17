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
//!   • se fija el servidor de actualizaciones y se abre la descarga del APK nuevo.
//! Ninguna página remota tiene acceso a estos comandos (capabilities/default.json, `local: true`).

use std::sync::{Arc, Mutex};

use serde_json::Value;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

mod almacen;
mod descargas;
mod modelos;
mod politica;
mod stt;

use almacen::{Almacen, Documento};
use descargas::{espacio_libre, ArchivoModelo, Descargas};
use stt::{Stt, Transcripcion};
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
fn models_remove(id: String, descargas: tauri::State<'_, Arc<Descargas>>) -> Result<(), String> {
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
        .invoke_handler(tauri::generate_handler![
            doc_get,
            doc_set,
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
            builder.build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("no fue posible iniciar DictaFlow");
}
