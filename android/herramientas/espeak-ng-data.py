#!/usr/bin/env python3
"""Genera src-tauri/recursos/espeak-ng-data.tar: los datos de espeak-ng que las voces Piper
necesitan para convertir texto en fonemas (solo español e inglés).

La app los lleva dentro (`include_bytes!` en src/tts.rs) y los extrae al usarlos por primera vez.
Salen del mismo repositorio que las voces (csukuangfj/vits-piper-*, preparado para sherpa-onnx):
fonemas comunes, `lang/` y `voices/`, y solo los diccionarios es/en (los demás pesan ~17 MB).

Uso: python3 -I android/herramientas/espeak-ng-data.py
"""
import io
import json
import pathlib
import tarfile
import urllib.parse
import urllib.request

REPO = "csukuangfj/vits-piper-es_MX-ald-medium"
IDIOMAS = {"es_dict", "en_dict"}
SALIDA = pathlib.Path(__file__).resolve().parent.parent / "src-tauri" / "recursos" / "espeak-ng-data.tar"


def quiero(ruta: str) -> bool:
    partes = ruta.split("/")
    if partes[1] in ("lang", "voices"):
        return True
    return len(partes) == 2 and (not partes[1].endswith("_dict") or partes[1] in IDIOMAS)


def main() -> None:
    url = f"https://huggingface.co/api/models/{REPO}/tree/main/espeak-ng-data?recursive=true"
    arbol = json.load(urllib.request.urlopen(url))
    archivos = sorted(f["path"] for f in arbol if f["type"] == "file" and quiero(f["path"]))
    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(SALIDA, "w", format=tarfile.USTAR_FORMAT) as tar:
        for ruta in archivos:
            datos = urllib.request.urlopen(f"https://huggingface.co/{REPO}/resolve/main/{urllib.parse.quote(ruta)}").read()
            info = tarfile.TarInfo(ruta)
            info.size, info.mode, info.mtime = len(datos), 0o644, 0
            tar.addfile(info, io.BytesIO(datos))
    print(f"{SALIDA}: {len(archivos)} archivos, {SALIDA.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
