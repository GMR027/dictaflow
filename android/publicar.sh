#!/usr/bin/env bash
# android/publicar.sh — prepara una versión de la app de Android para la web de DictaFlow.
#
#   ./publicar.sh "Novedades de esta versión"            → usa dist/dictaflow-android_<versión>.apk
#   ./publicar.sh "Novedades" ruta/al/archivo.apk
#   NOTAS_ARCHIVO=notas.txt ./publicar.sh                 → novedades desde un archivo
#
# Comprueba que el APK sea de la versión de src-tauri/tauri.conf.json y esté firmado con la llave
# de siempre (si no, Android no lo instalaría encima), y deja en site/app/android/:
#   dictaflow-android.apk   el APK
#   version.json            versión, versionCode, tamaño, SHA-256, fecha y novedades
# Después se publica con ./deploy/deploy.sh (construye la imagen de la web con estos archivos).
# La app lee /app/android/version.json y ofrece la actualización si versionCode es mayor.
set -euo pipefail
cd "$(dirname "$0")"
source ./entorno.sh

NOTAS="${1:-}"
[[ -z "$NOTAS" && -n "${NOTAS_ARCHIVO:-}" ]] && NOTAS="$(cat "$NOTAS_ARCHIVO")"
[[ -n "$NOTAS" ]] || { echo "Escribe las novedades: ./publicar.sh \"Qué cambia en esta versión\"" >&2; exit 2; }

VERSION=$(grep -m1 '"version"' src-tauri/tauri.conf.json | sed -E 's/.*"([0-9]+\.[0-9]+\.[0-9]+)".*/\1/')
APK="${2:-dist/dictaflow-android_${VERSION}.apk}"
[[ -f "$APK" ]] || { echo "No existe $APK. Compílalo con ./compilar.sh" >&2; exit 1; }
[[ "$APK" != *-depuracion.apk ]] || { echo "Ese es el APK de pruebas (--depurar): no se publica." >&2; exit 1; }

BT="$ANDROID_HOME/build-tools/$(ls "$ANDROID_HOME"/build-tools | sort -V | tail -1)"
# La versión dentro del APK debe ser la que se anuncia.
read -r APK_VERSION APK_CODE < <("$BT"/aapt2 dump badging "$APK" | sed -nE "s/^package: .*versionCode='([0-9]+)' versionName='([^']+)'.*/\2 \1/p")
IFS=. read -r MAYOR MENOR PARCHE <<<"$VERSION"
CODIGO=$((MAYOR * 1000000 + MENOR * 1000 + PARCHE))
[[ "$APK_VERSION" == "$VERSION" && "$APK_CODE" == "$CODIGO" ]] || {
  echo "El APK es la versión $APK_VERSION ($APK_CODE), pero tauri.conf.json dice $VERSION ($CODIGO)." >&2; exit 1; }

# Misma firma que la versión publicada antes (si la hay): si cambia, Android rechaza la actualización.
FIRMA=$("$BT"/apksigner verify --print-certs "$APK" | sed -nE 's/^Signer #1 certificate SHA-256 digest: //p')
[[ -n "$FIRMA" ]] || { echo "El APK no está firmado." >&2; exit 1; }
DESTINO=../site/app/android
mkdir -p "$DESTINO"
if [[ -f "$DESTINO/dictaflow-android.apk" ]]; then
  ANTERIOR=$("$BT"/apksigner verify --print-certs "$DESTINO/dictaflow-android.apk" | sed -nE 's/^Signer #1 certificate SHA-256 digest: //p')
  [[ "$ANTERIOR" == "$FIRMA" ]] || { echo "La firma no coincide con la del APK publicado ($ANTERIOR): Android no lo aceptaría como actualización." >&2; exit 1; }
  PUBLICADA=$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["versionCode"])' "$DESTINO/version.json" 2>/dev/null || echo 0)
  (( CODIGO > PUBLICADA )) || echo "Aviso: la versión publicada ($PUBLICADA) no es menor que esta ($CODIGO); la app no la ofrecerá como nueva. Sube \"version\" en tauri.conf.json." >&2
fi

cp "$APK" "$DESTINO/dictaflow-android.apk.tmp"
mv "$DESTINO/dictaflow-android.apk.tmp" "$DESTINO/dictaflow-android.apk"
SHA=$(sha256sum "$DESTINO/dictaflow-android.apk" | cut -d' ' -f1)
TAMANO=$(stat -c %s "$DESTINO/dictaflow-android.apk")
python3 -I - "$DESTINO/version.json" "$VERSION" "$CODIGO" "$TAMANO" "$SHA" "$NOTAS" <<'EOF'
import datetime, json, sys
dest, version, code, size, sha, notes = sys.argv[1:]
data = {"version": version, "versionCode": int(code), "size": int(size), "sha256": sha,
        "date": datetime.date.today().isoformat(), "notes": notes}
with open(dest, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write("\n")
EOF

echo "Listo para publicar DictaFlow para Android $VERSION (versionCode $CODIGO, $((TAMANO / 1000000)) MB)"
echo "  SHA-256 $SHA · firma $FIRMA"
echo "Ahora: ./deploy/deploy.sh   (desde la raíz del repositorio)"
