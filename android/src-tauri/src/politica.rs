//! Reglas puras (sin Tauri) de seguridad de la app. Viven aparte para probarlas en cualquier equipo:
//!   cargo test --manifest-path pruebas/Cargo.toml   (desde android/src-tauri)
//!
//!   • qué servidor de actualizaciones se acepta (`origen_valido`);
//!   • qué se abre dentro de la app y qué con la aplicación del sistema (`navegacion_interna`);
//!   • de dónde se puede descargar una actualización (`descarga_permitida`);
//!   • cómo se compara una versión (`version_code`);
//!   • qué dice el `version.json` del servidor (`leer_version`).

use url::Url;

/// Servidor de actualizaciones predeterminado (la web de DictaFlow).
pub const SERVIDOR_PREDETERMINADO: &str = "https://dictaflow.iguzman.com.mx";

/// Ruta pública de la descarga del APK en el servidor.
pub const RUTA_DESCARGA: &str = "/app/android/descargar";

/// Un servidor válido: HTTPS siempre; HTTP solo hacia localhost (pruebas con `adb reverse`;
/// la configuración de red de Android bloquea cualquier otro HTTP plano).
pub fn origen_valido(texto: &str) -> Result<String, String> {
    let url = Url::parse(texto.trim()).map_err(|_| "La dirección no es válida.".to_string())?;
    let host = url.host_str().ok_or("La dirección no tiene servidor.")?.to_string();
    match url.scheme() {
        "https" => {}
        "http" if es_local(&host) => {}
        _ => return Err("Usa una dirección https:// (http solo se permite para localhost).".into()),
    }
    Ok(url.origin().ascii_serialization())
}

fn es_local(host: &str) -> bool {
    host == "localhost" || host == "127.0.0.1"
}

/// ¿Se abre dentro de la app? Solo la interfaz empaquetada (tauri.localhost) y recursos internos.
/// Todo lo demás —la web de DictaFlow, GitHub, mapas, tel:, mailto:, WhatsApp— va al sistema.
pub fn navegacion_interna(url: &Url) -> bool {
    match url.scheme() {
        "about" | "data" | "blob" | "tauri" | "asset" => true,
        "http" | "https" => url.host_str() == Some("tauri.localhost") && url.port().is_none(),
        _ => false,
    }
}

/// La actualización solo se descarga del servidor de confianza y de su ruta de descarga.
pub fn descarga_permitida(texto: &str, servidor: &str) -> Result<Url, String> {
    let destino = Url::parse(texto).map_err(|_| "Dirección de descarga inválida.".to_string())?;
    if destino.origin().ascii_serialization() != servidor || destino.path() != RUTA_DESCARGA {
        return Err("La descarga no viene del servidor de confianza.".into());
    }
    Ok(destino)
}

/// versionCode de Android a partir de «mayor.menor.parche»: mayor·1e6 + menor·1e3 + parche.
pub fn version_code(version: &str) -> Option<u64> {
    let partes: Vec<u64> = version.trim().trim_start_matches('v').split('.').map(|p| p.parse().ok()).collect::<Option<_>>()?;
    match partes.as_slice() {
        [mayor, menor, parche] if *menor < 1000 && *parche < 1000 => Some(mayor * 1_000_000 + menor * 1_000 + parche),
        _ => None,
    }
}

/// Ruta pública del manifiesto de la última versión.
pub const RUTA_VERSION: &str = "/app/android/version.json";

/// Lo que publica el servidor en `version.json` (android/publicar.sh).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifiesto {
    version: String,
    version_code: u64,
    #[serde(default)]
    notes: String,
    #[serde(default)]
    size: u64,
    #[serde(default)]
    sha256: String,
    #[serde(default)]
    date: String,
}

/// Una actualización según el servidor, comparada con la versión instalada.
#[derive(Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Actualizacion {
    pub actual: String,
    pub version: String,
    pub disponible: bool,
    pub notas: String,
    pub bytes: u64,
    pub sha256: String,
    pub fecha: String,
    /// Dirección de descarga (siempre la del servidor de confianza).
    pub url: String,
}

/// Lee el `version.json` del servidor. Se rechaza si la versión y su versionCode no coinciden
/// (un manifiesto mal hecho no debe ofrecer como «nueva» una versión que no lo es).
pub fn leer_version(json: &str, actual: &str, servidor: &str) -> Result<Actualizacion, String> {
    let m: Manifiesto = serde_json::from_str(json).map_err(|_| "El servidor devolvió una respuesta de versión no válida.".to_string())?;
    let codigo = version_code(&m.version).ok_or_else(|| format!("Versión no válida en el servidor: «{}».", m.version))?;
    if codigo != m.version_code {
        return Err(format!("El servidor anuncia {} con un versionCode que no le corresponde ({}).", m.version, m.version_code));
    }
    let instalado = version_code(actual).ok_or_else(|| format!("Versión instalada no válida: «{actual}»."))?;
    let sha256 = m.sha256.to_ascii_lowercase();
    if !sha256.is_empty() && (sha256.len() != 64 || !sha256.bytes().all(|b| b.is_ascii_hexdigit())) {
        return Err("La huella SHA-256 del servidor no es válida.".into());
    }
    let mut url = Url::parse(servidor).map_err(|e| e.to_string())?.join(RUTA_DESCARGA).map_err(|e| e.to_string())?;
    url.query_pairs_mut().append_pair("v", &m.version);
    Ok(Actualizacion {
        actual: actual.to_string(),
        disponible: codigo > instalado,
        version: m.version,
        notas: m.notes.chars().take(4000).collect(),
        bytes: m.size,
        sha256,
        fecha: m.date.chars().take(40).collect(),
        url: url.to_string(),
    })
}

#[cfg(test)]
mod pruebas {
    use super::*;

    #[test]
    fn servidores_permitidos() {
        assert_eq!(origen_valido("https://dictaflow.iguzman.com.mx/es/").unwrap(), "https://dictaflow.iguzman.com.mx");
        assert_eq!(origen_valido("http://localhost:8080").unwrap(), "http://localhost:8080");
        assert_eq!(origen_valido(" http://127.0.0.1:8080/ ").unwrap(), "http://127.0.0.1:8080");
        assert!(origen_valido("http://192.168.1.10:8080").is_err());
        assert!(origen_valido("http://dictaflow.iguzman.com.mx").is_err());
        assert!(origen_valido("ftp://dictaflow.iguzman.com.mx").is_err());
        assert!(origen_valido("javascript:alert(1)").is_err());
        assert!(origen_valido("no es url").is_err());
        assert!(origen_valido(SERVIDOR_PREDETERMINADO).is_ok());
    }

    #[test]
    fn politica_de_navegacion() {
        let u = |t: &str| Url::parse(t).unwrap();
        assert!(navegacion_interna(&u("https://tauri.localhost/index.html")));
        assert!(navegacion_interna(&u("http://tauri.localhost/")));
        assert!(navegacion_interna(&u("blob:https://tauri.localhost/1234")));
        assert!(navegacion_interna(&u("about:blank")));
        assert!(!navegacion_interna(&u("https://tauri.localhost.evil.com/")));
        assert!(!navegacion_interna(&u("https://tauri.localhost:8443/")));
        assert!(!navegacion_interna(&u("https://dictaflow.iguzman.com.mx/es/")));
        assert!(!navegacion_interna(&u("https://github.com/GMR027/dictaflow")));
        assert!(!navegacion_interna(&u("https://wa.me/5215555555555")));
        assert!(!navegacion_interna(&u("tel:5551234567")));
        assert!(!navegacion_interna(&u("mailto:hola@example.com")));
        assert!(!navegacion_interna(&u("intent://scan/#Intent;scheme=zxing;end")));
    }

    #[test]
    fn descarga_de_actualizacion() {
        let s = SERVIDOR_PREDETERMINADO;
        assert!(descarga_permitida("https://dictaflow.iguzman.com.mx/app/android/descargar", s).is_ok());
        assert!(descarga_permitida("https://dictaflow.iguzman.com.mx/app/android/descargar?v=0.2.0", s).is_ok());
        assert!(descarga_permitida("https://dictaflow.iguzman.com.mx/otra/ruta", s).is_err());
        assert!(descarga_permitida("https://evil.com/app/android/descargar", s).is_err());
        assert!(descarga_permitida("https://dictaflow.iguzman.com.mx.evil.com/app/android/descargar", s).is_err());
        assert!(descarga_permitida("http://dictaflow.iguzman.com.mx/app/android/descargar", s).is_err());
        assert!(descarga_permitida("no es url", s).is_err());
    }

    #[test]
    fn codigos_de_version() {
        assert_eq!(version_code("0.1.0"), Some(1_000));
        assert_eq!(version_code("1.2.3"), Some(1_002_003));
        assert_eq!(version_code("v2.10.0"), Some(2_010_000));
        assert!(version_code("1.2.3").unwrap() > version_code("1.1.999").unwrap());
        assert_eq!(version_code("1.2"), None);
        assert_eq!(version_code("1.1000.0"), None);
        assert_eq!(version_code("1.2.x"), None);
    }

    #[test]
    fn manifiesto_de_version() {
        let s = SERVIDOR_PREDETERMINADO;
        let j = r#"{"version":"0.2.0","versionCode":2000,"notes":"Novedades","size":42,"sha256":"AB12AB12AB12AB12AB12AB12AB12AB12AB12AB12AB12AB12AB12AB12AB12AB12","date":"2026-11-18"}"#;
        let a = leer_version(j, "0.1.0", s).unwrap();
        assert!(a.disponible);
        assert_eq!(a.url, "https://dictaflow.iguzman.com.mx/app/android/descargar?v=0.2.0");
        assert!(descarga_permitida(&a.url, s).is_ok());
        assert_eq!(a.sha256, "ab12".repeat(16));
        assert!(!leer_version(j, "0.2.0", s).unwrap().disponible);
        assert!(!leer_version(j, "1.0.0", s).unwrap().disponible);
        assert!(leer_version(r#"{"version":"0.2.0","versionCode":3000}"#, "0.1.0", s).is_err());
        assert!(leer_version(r#"{"version":"0.2","versionCode":2000}"#, "0.1.0", s).is_err());
        assert!(leer_version(r#"{"version":"0.2.0","versionCode":2000,"sha256":"xyz"}"#, "0.1.0", s).is_err());
        assert!(leer_version("<html>", "0.1.0", s).is_err());
        assert!(leer_version(r#"{"version":"0.2.0","versionCode":2000}"#, "0.1.0", s).unwrap().notas.is_empty());
    }
}
