#!/usr/bin/env bash
# android/herramientas/sherpa-onnx.sh — descarga las librerías de sherpa-onnx para Android (arm64)
# que usa la lectura en voz alta, verificadas con su SHA-256, en $SHERPA_ONNX_LIB_DIR (entorno.sh).
# compilar.sh lo llama solo si faltan. Al subir de versión el crate sherpa-onnx (Cargo.toml),
# cambia aquí la versión y la huella del archivo publicado en GitHub.
set -euo pipefail
VERSION=1.13.8
SHA256=2ff63469a71cb6009aa2e3ed5f4a670f8abdcbe4bb9ffd23776afc792a6b4f44
DESTINO="${SHERPA_ONNX_LIB_DIR:?Carga antes android/entorno.sh}"
ARCHIVO="sherpa-onnx-v${VERSION}-android.tar.bz2"
CACHE="$(dirname "$DESTINO")"

mkdir -p "$CACHE"
if [[ ! -f "$CACHE/$ARCHIVO" ]]; then
  curl -fL --proto '=https' -o "$CACHE/$ARCHIVO.part" "https://github.com/k2-fsa/sherpa-onnx/releases/download/v${VERSION}/${ARCHIVO}"
  mv "$CACHE/$ARCHIVO.part" "$CACHE/$ARCHIVO"
fi
echo "$SHA256  $CACHE/$ARCHIVO" | sha256sum -c --quiet || { rm -f "$CACHE/$ARCHIVO"; echo "La huella de $ARCHIVO no coincide." >&2; exit 1; }
mkdir -p "$DESTINO"
# Solo la API de C y onnxruntime: la de JNI y la de C++ no hacen falta.
tar xjf "$CACHE/$ARCHIVO" -C "$DESTINO" --strip-components=3 \
  ./jniLibs/arm64-v8a/libsherpa-onnx-c-api.so ./jniLibs/arm64-v8a/libonnxruntime.so
echo "sherpa-onnx $VERSION listo en $DESTINO"
