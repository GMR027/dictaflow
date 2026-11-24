//! Almacén de documentos JSON con versión (sin Tauri, probado en `pruebas/`).
//!
//! Mismo formato que el escritorio (`src/main/storage.ts`): cada archivo es `{ version, data }` y
//! se escribe de forma atómica (archivo temporal + rename), para que un cierre a mitad de escritura
//! no deje datos corruptos. Así una copia de seguridad del escritorio se puede restaurar aquí.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Versión actual del formato de los datos (la misma que `SCHEMA_VERSION` en escritorio).
pub const VERSION_FORMATO: u32 = 2;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Documento {
    pub version: u32,
    pub data: Value,
}

/// Solo nombres simples (`settings`, `prompts`, `history`…): nada de rutas ni `..`.
pub fn nombre_valido(nombre: &str) -> Result<&str, String> {
    let ok = !nombre.is_empty()
        && nombre.len() <= 64
        && nombre.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_');
    if ok { Ok(nombre) } else { Err(format!("Nombre de documento no válido: «{nombre}».")) }
}

#[derive(Clone)]
pub struct Almacen {
    dir: PathBuf,
}

impl Almacen {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    fn ruta(&self, nombre: &str) -> Result<PathBuf, String> {
        Ok(self.dir.join(format!("{}.json", nombre_valido(nombre)?)))
    }

    /// Lee un documento. Un archivo sin envolver (formato v1) se devuelve como versión 1; uno roto,
    /// como ausente (igual que en escritorio: mejor arrancar con valores por defecto que no arrancar).
    pub fn leer(&self, nombre: &str) -> Result<Option<Documento>, String> {
        let ruta = self.ruta(nombre)?;
        let Ok(texto) = fs::read_to_string(&ruta) else { return Ok(None) };
        let Ok(valor) = serde_json::from_str::<Value>(&texto) else { return Ok(None) };
        let envuelto = valor.as_object().is_some_and(|o| o.contains_key("version") && o.contains_key("data"));
        if envuelto {
            Ok(serde_json::from_value(valor).ok())
        } else {
            Ok(Some(Documento { version: 1, data: valor }))
        }
    }

    /// Escribe un documento con la versión actual, de forma atómica.
    pub fn escribir(&self, nombre: &str, data: Value) -> Result<(), String> {
        let ruta = self.ruta(nombre)?;
        let doc = Documento { version: VERSION_FORMATO, data };
        // Sin pretty: los documentos no se editan a mano y en el teléfono cada byte cuenta.
        escribir_atomico(&ruta, serde_json::to_vec(&doc).map_err(|e| e.to_string())?.as_slice())
    }

    /// Borra un documento. Si no existe, no pasa nada.
    pub fn borrar(&self, nombre: &str) -> Result<(), String> {
        match fs::remove_file(self.ruta(nombre)?) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(format!("No se pudo borrar {nombre}: {e}")),
            _ => Ok(()),
        }
    }

    /// Nombres de los documentos guardados (para la copia de seguridad), ordenados.
    pub fn listar(&self) -> Vec<String> {
        let mut nombres: Vec<String> = fs::read_dir(&self.dir)
            .map(|l| l.flatten().filter_map(|e| e.file_name().into_string().ok()?.strip_suffix(".json").map(String::from)).collect())
            .unwrap_or_default();
        nombres.retain(|n| nombre_valido(n).is_ok());
        nombres.sort();
        nombres
    }
}

/// Escribe en `<ruta>.tmp`, sincroniza y renombra: el archivo final está completo o no cambia.
pub fn escribir_atomico(ruta: &Path, bytes: &[u8]) -> Result<(), String> {
    let dir = ruta.parent().ok_or("Ruta sin carpeta.")?;
    fs::create_dir_all(dir).map_err(|e| format!("No se pudo crear {}: {e}", dir.display()))?;
    let tmp = ruta.with_extension("json.tmp");
    let mut f = fs::File::create(&tmp).map_err(|e| format!("No se pudo escribir {}: {e}", tmp.display()))?;
    f.write_all(bytes).and_then(|_| f.sync_all()).map_err(|e| format!("No se pudo escribir {}: {e}", tmp.display()))?;
    fs::rename(&tmp, ruta).map_err(|e| format!("No se pudo guardar {}: {e}", ruta.display()))
}

#[cfg(test)]
mod pruebas {
    use super::*;
    use serde_json::json;

    fn temporal(nombre: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("dictaflow-almacen-{nombre}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn nombres() {
        assert!(nombre_valido("settings").is_ok());
        assert!(nombre_valido("pv-recordings_2").is_ok());
        assert!(nombre_valido("").is_err());
        assert!(nombre_valido("../secrets").is_err());
        assert!(nombre_valido("a/b").is_err());
        assert!(nombre_valido("Settings").is_err());
        assert!(nombre_valido(&"x".repeat(65)).is_err());
    }

    #[test]
    fn escribe_y_lee_con_version() {
        let dir = temporal("rt");
        let a = Almacen::new(&dir);
        assert_eq!(a.leer("settings").unwrap(), None);
        a.escribir("settings", json!({ "theme": "dark" })).unwrap();
        let doc = a.leer("settings").unwrap().unwrap();
        assert_eq!(doc, Documento { version: VERSION_FORMATO, data: json!({ "theme": "dark" }) });
        assert!(!dir.join("settings.json.tmp").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn formato_v1_y_archivos_rotos() {
        let dir = temporal("v1");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("history.json"), "[1,2]").unwrap();
        fs::write(dir.join("prompts.json"), "{ roto").unwrap();
        let a = Almacen::new(&dir);
        assert_eq!(a.leer("history").unwrap().unwrap(), Documento { version: 1, data: json!([1, 2]) });
        assert_eq!(a.leer("prompts").unwrap(), None);
        assert!(a.leer("../fuera").is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn listar_y_borrar() {
        let dir = temporal("lista");
        let a = Almacen::new(&dir);
        assert!(a.listar().is_empty());
        a.escribir("settings", json!({})).unwrap();
        a.escribir("library-0a1b", json!(null)).unwrap();
        fs::write(dir.join("otro.txt"), "x").unwrap();
        fs::write(dir.join("Mal.json"), "{}").unwrap();
        assert_eq!(a.listar(), ["library-0a1b", "settings"]);
        a.borrar("library-0a1b").unwrap();
        a.borrar("library-0a1b").unwrap();
        assert_eq!(a.listar(), ["settings"]);
        assert!(a.borrar("../x").is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}
