#!/usr/bin/env bash
# android/publicar.sh — publica una versión de la app de Android en la web de DictaFlow.
#
#   ./publicar.sh "Novedades de esta versión"            → usa dist/dictaflow-android_<versión>.apk
#   ./publicar.sh "Novedades" ruta/al/archivo.apk
#   NOTAS_ARCHIVO=notas.txt ./publicar.sh                 → novedades desde un archivo
#   -y                                                    → sin pedir confirmación
#
# El APK NO va a GitHub ni a la imagen de la web: se sube con `kubectl cp` al volumen del servicio
# `<release>-android` del clúster (deploy/helm/dictaflow-site/templates/android.yaml), que lo sirve en
#   https://<web>/app/android/descargar      el APK
#   https://<web>/app/android/version.json   versión, versionCode, tamaño, SHA-256, firma y novedades
# La app lo consulta al abrirse y en Ajustes; la página de inicio muestra la tarjeta de descarga.
#
# Comprueba que el APK sea de la versión de src-tauri/tauri.conf.json, que esté firmado con la misma
# llave que el publicado (si no, Android no lo instalaría encima) y que sea más nuevo.
# Variables: NAMESPACE=dictaflow  RELEASE=dictaflow-site  HOST=dictaflow.iguzman.com.mx  KUBE_CONTEXT=…
set -euo pipefail
cd "$(dirname "$0")"
source ./entorno.sh

NAMESPACE=${NAMESPACE:-dictaflow}
RELEASE=${RELEASE:-dictaflow-site}
HOST=${HOST:-dictaflow.iguzman.com.mx}
SI=0 ARGS=()
for a in "$@"; do [[ "$a" == "-y" ]] && SI=1 || ARGS+=("$a"); done
NOTAS="${ARGS[0]:-}"
[[ -z "$NOTAS" && -n "${NOTAS_ARCHIVO:-}" ]] && NOTAS="$(cat "$NOTAS_ARCHIVO")"
[[ -n "$NOTAS" ]] || { echo "Escribe las novedades: ./publicar.sh \"Qué cambia en esta versión\"" >&2; exit 2; }

VERSION=$(grep -m1 '"version"' src-tauri/tauri.conf.json | sed -E 's/.*"([0-9]+\.[0-9]+\.[0-9]+)".*/\1/')
APK="${ARGS[1]:-dist/dictaflow-android_${VERSION}.apk}"
[[ -f "$APK" ]] || { echo "No existe $APK. Compílalo con ./compilar.sh" >&2; exit 1; }
[[ "$APK" != *-depuracion.apk ]] || { echo "Ese es el APK de pruebas (--depurar): no se publica." >&2; exit 1; }

BT="$ANDROID_HOME/build-tools/$(ls "$ANDROID_HOME"/build-tools | sort -V | tail -1)"
# La versión dentro del APK debe ser la que se anuncia.
read -r APK_VERSION APK_CODE < <("$BT"/aapt2 dump badging "$APK" | sed -nE "s/^package: .*versionCode='([0-9]+)' versionName='([^']+)'.*/\2 \1/p")
IFS=. read -r MAYOR MENOR PARCHE <<<"$VERSION"
CODIGO=$((MAYOR * 1000000 + MENOR * 1000 + PARCHE))
[[ "$APK_VERSION" == "$VERSION" && "$APK_CODE" == "$CODIGO" ]] || {
  echo "El APK es la versión $APK_VERSION ($APK_CODE), pero tauri.conf.json dice $VERSION ($CODIGO)." >&2; exit 1; }
FIRMA=$("$BT"/apksigner verify --print-certs "$APK" | sed -nE 's/^.*certificate SHA-256 digest: //p' | head -1)
[[ -n "$FIRMA" ]] || { echo "El APK no está firmado." >&2; exit 1; }
SHA=$(sha256sum "$APK" | cut -d' ' -f1)
TAMANO=$(stat -c %s "$APK")

[[ -n "${KUBE_CONTEXT:-}" ]] && kubectl config use-context "$KUBE_CONTEXT" >/dev/null
POD=$(kubectl -n "$NAMESPACE" get pod -l "app.kubernetes.io/name=dictaflow-site-android,app.kubernetes.io/instance=$RELEASE" \
  --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
[[ -n "$POD" ]] || { echo "No hay servicio de Android en el clúster ($NAMESPACE/$RELEASE-android). Despliega antes la web: ./deploy/deploy.sh" >&2; exit 1; }

# Lo publicado ahora: misma firma y versión menor.
ACTUAL=$(kubectl -n "$NAMESPACE" exec "$POD" -- cat /srv/version.json 2>/dev/null || true)
if [[ -n "$ACTUAL" ]]; then
  read -r PUB_CODE PUB_FIRMA < <(python3 -I -c 'import json,sys; d=json.loads(sys.argv[1]); print(d.get("versionCode",0), d.get("signer","-"))' "$ACTUAL")
  [[ "$PUB_FIRMA" == "-" || "$PUB_FIRMA" == "$FIRMA" ]] || { echo "La firma ($FIRMA) no es la del APK publicado ($PUB_FIRMA): Android no lo aceptaría como actualización." >&2; exit 1; }
  (( CODIGO > PUB_CODE )) || { echo "Ya está publicada la versión con versionCode $PUB_CODE; esta es $CODIGO. Sube \"version\" en tauri.conf.json." >&2; exit 1; }
fi

echo "Publicar DictaFlow para Android $VERSION (versionCode $CODIGO, $((TAMANO / 1000000)) MB)"
echo "  SHA-256 $SHA"
echo "  en $(kubectl config current-context) → $NAMESPACE/$POD → https://$HOST/app/android/"
if [[ $SI != 1 ]]; then read -r -p "¿Continuar? [s/N] " r; [[ "$r" =~ ^[sSyY]$ ]] || { echo "Cancelado."; exit 1; }; fi

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
python3 -I - "$TMP/version.json" "$VERSION" "$CODIGO" "$TAMANO" "$SHA" "$FIRMA" "$NOTAS" <<'EOF'
import datetime, json, sys
dest, version, code, size, sha, signer, notes = sys.argv[1:]
data = {"version": version, "versionCode": int(code), "size": int(size), "sha256": sha, "signer": signer,
        "date": datetime.date.today().isoformat(), "notes": notes}
with open(dest, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
    f.write("\n")
EOF

# Primero el APK (con otro nombre, se comprueba y se renombra) y al final version.json: nadie ve una
# versión anunciada cuyo APK aún no esté completo.
kubectl -n "$NAMESPACE" cp "$APK" "$POD:/srv/.subiendo.apk"
REMOTO=$(kubectl -n "$NAMESPACE" exec "$POD" -- sha256sum /srv/.subiendo.apk | cut -d' ' -f1)
[[ "$REMOTO" == "$SHA" ]] || { echo "El APK llegó dañado al servidor ($REMOTO)." >&2; kubectl -n "$NAMESPACE" exec "$POD" -- rm -f /srv/.subiendo.apk; exit 1; }
kubectl -n "$NAMESPACE" exec "$POD" -- mv -f /srv/.subiendo.apk /srv/dictaflow-android.apk
kubectl -n "$NAMESPACE" cp "$TMP/version.json" "$POD:/srv/.version.json"
kubectl -n "$NAMESPACE" exec "$POD" -- mv -f /srv/.version.json /srv/version.json

if curl -fsS -m 20 "https://$HOST/app/android/version.json" | grep -q "\"versionCode\": $CODIGO"; then
  echo "Publicado: https://$HOST/app/android/descargar"
else
  echo "Subido, pero https://$HOST/app/android/version.json aún no muestra la versión nueva. Revisa el Ingress." >&2
fi
