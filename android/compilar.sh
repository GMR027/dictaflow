#!/usr/bin/env bash
# android/compilar.sh — compila el APK firmado de DictaFlow para Android (arm64).
#
#   ./compilar.sh            → APK release firmado en android/dist/dictaflow-android_<versión>.apk
#   ./compilar.sh --instalar → además lo instala en el teléfono conectado por ADB
#   ./compilar.sh --depurar  → APK de pruebas con el WebView inspeccionable (chrome://inspect);
#                              misma firma, así que se instala encima sin borrar los modelos.
#                              Sale como …-depuracion.apk y NO se publica.
#
# La versión sale de src-tauri/tauri.conf.json ("version"); súbela antes de cada publicación.
# La interfaz (src/renderer) se compila sola antes (beforeBuildCommand → npm run android:ui).
set -euo pipefail
cd "$(dirname "$0")"
source ./entorno.sh
FIRMA="${DICTAFLOW_FIRMA:-$HOME/.config/dictaflow-android/keystore.properties}"
[[ -f "$FIRMA" ]] || { echo "Falta la llave de firma ($FIRMA). Sin ella Android no aceptará el APK como actualización." >&2; exit 1; }

INSTALAR=0 FEATURES=() SUFIJO=""
for arg in "$@"; do
  case "$arg" in
    --instalar) INSTALAR=1 ;;
    --depurar) FEATURES=(--features depuracion) SUFIJO="-depuracion" ;;
    *) echo "Opción desconocida: $arg (usa --instalar y/o --depurar)" >&2; exit 2 ;;
  esac
done

[[ -f "$SHERPA_ONNX_LIB_DIR/libsherpa-onnx-c-api.so" ]] || ./herramientas/sherpa-onnx.sh
# Librerías de la voz dentro del APK (la copia automática de sherpa-onnx-sys se salta si la carpeta
# ya tiene otras .so, como la de la propia app).
JNI=src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a
mkdir -p "$JNI" && cp "$SHERPA_ONNX_LIB_DIR"/libsherpa-onnx-c-api.so "$SHERPA_ONNX_LIB_DIR"/libonnxruntime.so "$JNI"/

VERSION=$(grep -m1 '"version"' src-tauri/tauri.conf.json | sed -E 's/.*"([0-9]+\.[0-9]+\.[0-9]+)".*/\1/')

(cd src-tauri && cargo tauri android build --apk --target aarch64 "${FEATURES[@]}")

mkdir -p dist
SALIDA="dist/dictaflow-android_${VERSION}${SUFIJO}.apk"
cp src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk "$SALIDA"
"$ANDROID_HOME"/build-tools/$(ls "$ANDROID_HOME"/build-tools | sort -V | tail -1)/apksigner verify --print-certs "$SALIDA" | grep -m1 'SHA-256' || true
echo "Listo: $SALIDA ($(du -h "$SALIDA" | cut -f1)) · SHA-256 $(sha256sum "$SALIDA" | cut -d' ' -f1)"

if [[ $INSTALAR == 1 ]]; then
  adb install -r "$SALIDA"
fi
