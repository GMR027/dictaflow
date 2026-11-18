#!/usr/bin/env bash
# deploy/publicar-escritorio.sh — publica los instaladores de escritorio (Linux) en la web de DictaFlow.
#
#   ./deploy/publicar-escritorio.sh "Novedades de esta versión"     → usa release/ (npm run dist)
#   -y                                                               → sin pedir confirmación
#
# Se suben con `kubectl cp` al mismo volumen que el APK (servicio <release>-android), carpeta linux/,
# y se sirven en
#   https://<web>/app/linux/<archivo>          cada instalador
#   https://<web>/app/linux/SHA256SUMS.txt     sus sumas (la página y la app las comprueban)
#   https://<web>/app/linux/version.json       versión, archivos, sumas y novedades (lo lee el actualizador)
# Comprueba que los paquetes sean de la versión de package.json y que sea más nueva que la publicada.
# Variables: NAMESPACE=dictaflow  RELEASE=dictaflow-site  HOST=dictaflow.iguzman.com.mx  KUBE_CONTEXT=…
set -euo pipefail
cd "$(dirname "$0")/.."

NAMESPACE=${NAMESPACE:-dictaflow}
RELEASE=${RELEASE:-dictaflow-site}
HOST=${HOST:-dictaflow.iguzman.com.mx}
SI=0 ARGS=()
for a in "$@"; do [[ "$a" == "-y" ]] && SI=1 || ARGS+=("$a"); done
NOTAS="${ARGS[0]:-}"
[[ -n "$NOTAS" ]] || { echo "Escribe las novedades: ./deploy/publicar-escritorio.sh \"Qué cambia en esta versión\"" >&2; exit 2; }

VERSION=$(node -p 'require("./package.json").version')
ARCHIVOS=(dictaflow-linux-amd64.deb dictaflow-linux-x86_64.rpm dictaflow-linux-x86_64.pacman dictaflow-linux-x86_64.AppImage dictaflow-linux-x64.tar.gz)
for f in "${ARCHIVOS[@]}"; do [[ -f "release/$f" ]] || { echo "Falta release/$f. Compila con: npm run dist" >&2; exit 1; }; done
# El .deb dice su versión: tiene que ser la de package.json (evita subir una compilación vieja).
DEB_VERSION=$(dpkg-deb -f release/dictaflow-linux-amd64.deb Version 2>/dev/null || echo "?")
[[ "$DEB_VERSION" == "$VERSION" ]] || { echo "release/ es de la versión $DEB_VERSION, pero package.json dice $VERSION. Vuelve a compilar." >&2; exit 1; }

[[ -n "${KUBE_CONTEXT:-}" ]] && kubectl config use-context "$KUBE_CONTEXT" >/dev/null
POD=$(kubectl -n "$NAMESPACE" get pod -l "app.kubernetes.io/name=dictaflow-site-android,app.kubernetes.io/instance=$RELEASE" \
  --field-selector=status.phase=Running -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
[[ -n "$POD" ]] || { echo "No hay servicio de descargas en el clúster ($NAMESPACE/$RELEASE-android). Despliega antes la web: ./deploy/deploy.sh" >&2; exit 1; }

ACTUAL=$(kubectl -n "$NAMESPACE" exec "$POD" -- cat /srv/linux/version.json 2>/dev/null || true)
if [[ -n "$ACTUAL" ]]; then
  PUB=$(python3 -I -c 'import json,sys; print(json.loads(sys.argv[1]).get("version","0.0.0"))' "$ACTUAL")
  python3 -I -c 'import sys; a,b=[tuple(map(int,v.split("."))) for v in sys.argv[1:]]; sys.exit(0 if a>b else 1)' "$VERSION" "$PUB" \
    || { echo "Ya está publicada la $PUB; esta es la $VERSION. Sube \"version\" en package.json." >&2; exit 1; }
fi

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
(cd release && sha256sum "${ARCHIVOS[@]}") > "$TMP/SHA256SUMS.txt"
python3 -I - "$TMP/version.json" "$VERSION" "$NOTAS" "$TMP/SHA256SUMS.txt" release <<'EOF'
import datetime, json, os, sys
dest, version, notes, sums, rel = sys.argv[1:]
files = {}
for line in open(sums, encoding="utf-8"):
    h, name = line.split()
    files[name] = {"sha256": h, "size": os.path.getsize(os.path.join(rel, name))}
with open(dest, "w", encoding="utf-8") as f:
    json.dump({"version": version, "date": datetime.date.today().isoformat(), "notes": notes, "files": files}, f, ensure_ascii=False, indent=2)
    f.write("\n")
EOF

echo "Publicar DictaFlow para Linux $VERSION ($(du -ch "${ARCHIVOS[@]/#/release/}" | tail -1 | cut -f1) en ${#ARCHIVOS[@]} archivos)"
echo "  en $(kubectl config current-context) → $NAMESPACE/$POD → https://$HOST/app/linux/"
if [[ $SI != 1 ]]; then read -r -p "¿Continuar? [s/N] " r; [[ "$r" =~ ^[sSyY]$ ]] || { echo "Cancelado."; exit 1; }; fi

kubectl -n "$NAMESPACE" exec "$POD" -- mkdir -p /srv/linux
# Cada archivo con otro nombre, se comprueba y se renombra; al final las sumas y version.json:
# nadie ve anunciada una versión cuyos archivos aún no estén completos.
for f in "${ARCHIVOS[@]}"; do
  SHA=$(grep " $f\$" "$TMP/SHA256SUMS.txt" | cut -d' ' -f1)
  echo "   $f"
  kubectl -n "$NAMESPACE" cp "release/$f" "$POD:/srv/linux/.subiendo-$f"
  REMOTO=$(kubectl -n "$NAMESPACE" exec "$POD" -- sha256sum "/srv/linux/.subiendo-$f" | cut -d' ' -f1)
  [[ "$REMOTO" == "$SHA" ]] || { echo "$f llegó dañado al servidor." >&2; kubectl -n "$NAMESPACE" exec "$POD" -- rm -f "/srv/linux/.subiendo-$f"; exit 1; }
  kubectl -n "$NAMESPACE" exec "$POD" -- mv -f "/srv/linux/.subiendo-$f" "/srv/linux/$f"
done
for f in SHA256SUMS.txt version.json; do
  kubectl -n "$NAMESPACE" cp "$TMP/$f" "$POD:/srv/linux/.$f"
  kubectl -n "$NAMESPACE" exec "$POD" -- mv -f "/srv/linux/.$f" "/srv/linux/$f"
done

if curl -fsS -m 20 "https://$HOST/app/linux/version.json" | grep -q "\"version\": \"$VERSION\""; then
  echo "Publicado: https://$HOST/app/linux/"
else
  echo "Subido, pero https://$HOST/app/linux/version.json aún no muestra la versión nueva. Revisa el Ingress (./deploy/deploy.sh)." >&2
fi
