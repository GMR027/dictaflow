//! Reglas puras (sin Tauri) de seguridad de la app. Viven aparte para probarlas en cualquier equipo:
//!   cargo test --manifest-path pruebas/Cargo.toml   (desde android/src-tauri)
//!
//!   • qué servidor de actualizaciones se acepta (`origen_valido`);
//!   • qué se abre dentro de la app y qué con la aplicación del sistema (`navegacion_interna`);
//!   • de dónde se puede descargar una actualización (`descarga_permitida`);
//!   • cómo se compara una versión (`version_code`).

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
}
