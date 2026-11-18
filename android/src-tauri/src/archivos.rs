//! Archivos propios de la app (sin Tauri, probado en `pruebas/`): audio de reuniones, grabaciones
//! de «Mis voces», audiolibros, exportaciones a medio hacer… Todo vive en `<datos de la app>/archivos`
//! y la interfaz solo puede nombrar rutas relativas sencillas dentro de esa carpeta.

use std::fs;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;

/// Una ruta relativa válida: de 1 a 4 partes de `[a-z0-9._-]`, sin empezar por punto (nada de `..`).
pub fn ruta_valida(ruta: &str) -> Result<PathBuf, String> {
    let partes: Vec<&str> = ruta.split('/').collect();
    let ok = (1..=4).contains(&partes.len())
        && partes.iter().all(|p| {
            !p.is_empty()
                && p.len() <= 100
                && !p.starts_with('.')
                && p.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'-' || b == b'_')
        });
    if ok { Ok(partes.iter().collect()) } else { Err(format!("Ruta de archivo no válida: «{ruta}».")) }
}

#[derive(Debug, Serialize, PartialEq)]
pub struct Entrada {
    pub nombre: String,
    pub bytes: u64,
    pub carpeta: bool,
}

pub struct Archivos {
    dir: PathBuf,
}

impl Archivos {
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    #[cfg(test)]
    pub fn dir(&self) -> &Path {
        &self.dir
    }

    pub fn ruta(&self, rel: &str) -> Result<PathBuf, String> {
        Ok(self.dir.join(ruta_valida(rel)?))
    }

    /// Escribe (o añade al final de) un archivo, creando sus carpetas.
    pub fn escribir(&self, rel: &str, datos: &[u8], anexar: bool) -> Result<(), String> {
        let ruta = self.ruta(rel)?;
        if let Some(dir) = ruta.parent() {
            fs::create_dir_all(dir).map_err(|e| format!("No se pudo crear la carpeta: {e}"))?;
        }
        let mut f = fs::OpenOptions::new()
            .create(true)
            .write(true)
            .append(anexar)
            .truncate(!anexar)
            .open(&ruta)
            .map_err(|e| format!("No se pudo escribir {rel}: {e}"))?;
        f.write_all(datos).map_err(|e| format!("No se pudo escribir {rel}: {e}"))
    }

    pub fn leer(&self, rel: &str) -> Result<Vec<u8>, String> {
        fs::read(self.ruta(rel)?).map_err(|e| format!("No se pudo leer {rel}: {e}"))
    }

    /// Borra un archivo o una carpeta entera. Lo que no existe no es un error.
    pub fn borrar(&self, rel: &str) -> Result<(), String> {
        let ruta = self.ruta(rel)?;
        let r = if ruta.is_dir() { fs::remove_dir_all(&ruta) } else { fs::remove_file(&ruta) };
        match r {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(format!("No se pudo borrar {rel}: {e}")),
            _ => Ok(()),
        }
    }

    /// Contenido de una carpeta (vacío si no existe), ordenado por nombre. Las carpetas llevan el
    /// tamaño total de lo que contienen.
    pub fn listar(&self, rel: &str) -> Result<Vec<Entrada>, String> {
        let ruta = self.ruta(rel)?;
        let Ok(leidas) = fs::read_dir(&ruta) else { return Ok(vec![]) };
        let mut lista: Vec<Entrada> = leidas
            .flatten()
            .filter_map(|e| {
                let tipo = e.file_type().ok()?;
                let nombre = e.file_name().into_string().ok()?;
                let bytes = if tipo.is_dir() { tamano(&e.path()) } else { e.metadata().ok()?.len() };
                Some(Entrada { nombre, bytes, carpeta: tipo.is_dir() })
            })
            .collect();
        lista.sort_by(|a, b| a.nombre.cmp(&b.nombre));
        Ok(lista)
    }

    /// Une varios archivos en uno (los fotogramas MP3 se pueden concatenar).
    pub fn unir(&self, partes: &[String], destino: &str) -> Result<(), String> {
        let destino = self.ruta(destino)?;
        let tmp = destino.with_extension("tmp");
        let mut salida = fs::File::create(&tmp).map_err(|e| format!("No se pudo crear el audio: {e}"))?;
        for p in partes {
            let mut f = fs::File::open(self.ruta(p)?).map_err(|e| format!("Falta {p}: {e}"))?;
            std::io::copy(&mut f, &mut salida).map_err(|e| format!("No se pudo unir {p}: {e}"))?;
        }
        salida.sync_all().map_err(|e| e.to_string())?;
        fs::rename(&tmp, &destino).map_err(|e| format!("No se pudo guardar el audio: {e}"))
    }

    /// Ajusta la cabecera de un WAV escrito por partes (se empieza con tamaño 0) al tamaño real de
    /// los datos y devuelve su duración en segundos.
    pub fn cerrar_wav(&self, rel: &str) -> Result<f64, String> {
        let ruta = self.ruta(rel)?;
        let mut f = fs::OpenOptions::new().read(true).write(true).open(&ruta).map_err(|e| format!("No se pudo abrir {rel}: {e}"))?;
        let mut cabecera = [0u8; 44];
        f.read_exact(&mut cabecera).map_err(|_| format!("{rel} no es un WAV."))?;
        let total = f.metadata().map_err(|e| e.to_string())?.len();
        let (riff, datos, segundos) = tamanos_wav(&cabecera, total)?;
        f.seek(SeekFrom::Start(4)).and_then(|_| f.write_all(&riff.to_le_bytes())).map_err(|e| e.to_string())?;
        f.seek(SeekFrom::Start(40)).and_then(|_| f.write_all(&datos.to_le_bytes())).map_err(|e| e.to_string())?;
        Ok(segundos)
    }
}

/// Tamaños de la cabecera de un WAV canónico (44 bytes) para un archivo de `total` bytes:
/// (tamaño RIFF, tamaño de datos, duración en segundos).
pub fn tamanos_wav(cabecera: &[u8; 44], total: u64) -> Result<(u32, u32, f64), String> {
    if &cabecera[0..4] != b"RIFF" || &cabecera[8..12] != b"WAVE" || &cabecera[36..40] != b"data" {
        return Err("El archivo no es un WAV canónico.".into());
    }
    let datos = u32::try_from(total.saturating_sub(44)).map_err(|_| "Audio demasiado largo.")?;
    let por_segundo = u32::from_le_bytes([cabecera[28], cabecera[29], cabecera[30], cabecera[31]]);
    let segundos = if por_segundo > 0 { datos as f64 / por_segundo as f64 } else { 0.0 };
    Ok((datos + 36, datos, segundos))
}

/// Bytes que ocupa una carpeta (recorriéndola entera).
pub fn tamano(dir: &Path) -> u64 {
    let Ok(leidas) = fs::read_dir(dir) else { return 0 };
    leidas
        .flatten()
        .map(|e| match e.file_type() {
            Ok(t) if t.is_dir() => tamano(&e.path()),
            Ok(_) => e.metadata().map(|m| m.len()).unwrap_or(0),
            Err(_) => 0,
        })
        .sum()
}

/// Nombre de archivo que se ofrece al guardar: sin barras ni caracteres de control, con algo de
/// texto antes de la extensión.
pub fn nombre_sugerido(nombre: &str, ext: &str) -> String {
    let limpio: String = nombre
        .chars()
        .map(|c| if c.is_control() || "/\\:*?\"<>|".contains(c) { ' ' } else { c })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let base = limpio.strip_suffix(&format!(".{ext}")).unwrap_or(&limpio).trim_matches('.');
    let base: String = base.chars().take(80).collect();
    format!("{}.{ext}", if base.trim().is_empty() { "dictaflow" } else { base.trim() })
}

#[cfg(test)]
mod pruebas {
    use super::*;

    fn temporal(nombre: &str) -> Archivos {
        let dir = std::env::temp_dir().join(format!("dictaflow-archivos-{nombre}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        Archivos::new(dir)
    }

    #[test]
    fn rutas() {
        assert!(ruta_valida("reuniones/0f1e-2d.wav").is_ok());
        assert!(ruta_valida("audiolibros/mi-libro/001-capitulo.mp3").is_ok());
        for mala in ["", "/abs", "a//b", "../x", "a/../b", ".oculto", "a/.b", "Mayus.wav", "a b", "a/b/c/d/e", "a\\b"] {
            assert!(ruta_valida(mala).is_err(), "{mala}");
        }
    }

    #[test]
    fn escribir_anexar_listar_unir_borrar() {
        let a = temporal("ciclo");
        a.escribir("libro/001.mp3", b"uno", false).unwrap();
        a.escribir("libro/002.mp3", b"dos", false).unwrap();
        a.escribir("libro/002.mp3", b"+", true).unwrap();
        assert_eq!(a.leer("libro/002.mp3").unwrap(), b"dos+");
        a.escribir("libro/001.mp3", b"UNO", false).unwrap();
        a.unir(&["libro/001.mp3".into(), "libro/002.mp3".into()], "libro/todo.mp3").unwrap();
        assert_eq!(a.leer("libro/todo.mp3").unwrap(), b"UNOdos+");
        let raiz = a.listar("libro").unwrap();
        assert_eq!(raiz.iter().map(|e| e.nombre.as_str()).collect::<Vec<_>>(), ["001.mp3", "002.mp3", "todo.mp3"]);
        a.escribir("otro.txt", b"x", false).unwrap();
        assert_eq!(a.listar("libro").unwrap().len(), 3);
        assert!(a.listar("no-existe").unwrap().is_empty());
        a.borrar("libro").unwrap();
        a.borrar("libro").unwrap();
        assert!(a.leer("libro/001.mp3").is_err());
        let _ = fs::remove_dir_all(a.dir());
    }

    #[test]
    fn wav_por_partes() {
        let a = temporal("wav");
        let cabecera = crate::modelos::wav_pcm16(&[], 16000);
        a.escribir("reuniones/r.wav", &cabecera, false).unwrap();
        a.escribir("reuniones/r.wav", &vec![0u8; 32000], true).unwrap();
        assert_eq!(a.cerrar_wav("reuniones/r.wav").unwrap(), 1.0);
        let wav = a.leer("reuniones/r.wav").unwrap();
        assert_eq!(u32::from_le_bytes(wav[4..8].try_into().unwrap()), 32036);
        assert_eq!(u32::from_le_bytes(wav[40..44].try_into().unwrap()), 32000);
        a.escribir("no.wav", b"hola", false).unwrap();
        assert!(a.cerrar_wav("no.wav").is_err());
        let _ = fs::remove_dir_all(a.dir());
    }

    #[test]
    fn nombres_sugeridos() {
        assert_eq!(nombre_sugerido("Reunión 5/11: ventas", "pdf"), "Reunión 5 11 ventas.pdf");
        assert_eq!(nombre_sugerido("acta.pdf", "pdf"), "acta.pdf");
        assert_eq!(nombre_sugerido("  ", "md"), "dictaflow.md");
        assert_eq!(nombre_sugerido("..", "ics"), "dictaflow.ics");
    }
}
