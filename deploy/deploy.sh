#!/usr/bin/env bash
# Despliega / actualiza la web de DictaFlow en el clúster, SIN registro de imágenes ni GitHub:
#   genera la página en este equipo → la empaqueta (.tar.gz) → la sube como ConfigMaps →
#   helm upgrade --install (nginx oficial de Docker Hub la desempaqueta al arrancar) → espera.
#
#   ./deploy/deploy.sh             # generar, subir y desplegar (pide confirmación)
#   ./deploy/deploy.sh -y          # sin confirmación
#   ./deploy/deploy.sh --dry-run   # genera y muestra lo que se desplegaría; no toca el clúster
#   ./deploy/deploy.sh --rollback  # vuelve a la revisión anterior
#
# Si la página no cambió, el hash es el mismo y los pods no se reinician.
# El APK de Android va aparte (android/publicar.sh), en el volumen del servicio <release>-android.
#
# Variables (todas opcionales):
#   NAMESPACE=dictaflow  RELEASE=dictaflow-site  HOST=dictaflow.iguzman.com.mx
#   INGRESS_CLASS=nginx  CLUSTER_ISSUER=letsencrypt-prod  REPLICAS=2  KUBE_CONTEXT=<contexto>
set -euo pipefail

cd "$(dirname "$0")/.."

NAMESPACE=${NAMESPACE:-dictaflow}
RELEASE=${RELEASE:-dictaflow-site}
HOST=${HOST:-dictaflow.iguzman.com.mx}
INGRESS_CLASS=${INGRESS_CLASS:-nginx}
CLUSTER_ISSUER=${CLUSTER_ISSUER:-letsencrypt-prod}
REPLICAS=${REPLICAS:-2}
CHART=deploy/helm/dictaflow-site
# Las sumas de las descargas de escritorio (solo lectura, para mostrarlas en la página).
REPO_SLUG=GMR027/dictaflow
# Trozos de 600 KB: en base64 quedan ~800 KB, por debajo del límite de 1 MiB por ConfigMap.
PART_BYTES=600000

ASSUME_YES=0 DRY=0 ROLLBACK=0
for a in "$@"; do
  case "$a" in
    -y|--yes) ASSUME_YES=1 ;;
    --dry-run) DRY=1 ;;
    --rollback) ROLLBACK=1 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "Opción desconocida: $a" >&2; exit 2 ;;
  esac
done

say()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "Falta '$1' en el PATH."; }

need helm; need kubectl; need node; need tar; need sha256sum; need split

# Un clúster equivocado es el error más caro: se muestra y se confirma siempre
[ -n "${KUBE_CONTEXT:-}" ] && kubectl config use-context "$KUBE_CONTEXT" >/dev/null
CTX=$(kubectl config current-context)
SERVER=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}')
confirm() { [ "$ASSUME_YES" = 1 ] || { read -r -p "¿Continuar? [s/N] " r; [[ "$r" =~ ^[sSyY]$ ]] || die "Cancelado."; }; }

if [ "$ROLLBACK" = 1 ]; then
  say "Clúster: $CTX ($SERVER) · $NAMESPACE/$RELEASE"
  confirm
  helm history "$RELEASE" -n "$NAMESPACE" --max 5
  helm rollback "$RELEASE" -n "$NAMESPACE" --wait --timeout 3m
  say "Rollback hecho."; exit 0
fi

WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT

say "Generando la página"
curl -fsSL -o "$WORK/SHA256SUMS.txt" "https://github.com/$REPO_SLUG/releases/latest/download/SHA256SUMS.txt" || : > "$WORK/SHA256SUMS.txt"
CHECKSUMS="$WORK/SHA256SUMS.txt" node site/build.mjs
mkdir -p "$WORK/web/conf"
cp -r site/dist "$WORK/web/html"
cp deploy/nginx.conf "$WORK/web/conf/default.conf"
# Empaquetado reproducible: la misma página da el mismo hash (y no reinicia los pods).
tar --sort=name --mtime=@0 --owner=0 --group=0 --numeric-owner -C "$WORK/web" -cf - html conf | gzip -n -9 > "$WORK/web.tar.gz"
HASH=$(sha256sum "$WORK/web.tar.gz" | cut -d' ' -f1)
SHORT=${HASH:0:12}
mkdir "$WORK/parts"
split -b "$PART_BYTES" -d -a 3 "$WORK/web.tar.gz" "$WORK/parts/part-"
PARTS=$(find "$WORK/parts" -type f | wc -l)

say "Clúster:    $CTX ($SERVER)"
say "Namespace:  $NAMESPACE   Release: $RELEASE"
say "Página:     $SHORT · $(du -h "$WORK/web.tar.gz" | cut -f1) en $PARTS trozo(s)"
say "URL:        https://$HOST"

HELM_ARGS=(upgrade --install "$RELEASE" "$CHART" -n "$NAMESPACE" --create-namespace
  --set "web.hash=$HASH" --set "web.parts=$PARTS"
  --set "ingress.host=$HOST" --set "ingress.className=$INGRESS_CLASS"
  --set "ingress.tls.clusterIssuer=$CLUSTER_ISSUER" --set "replicaCount=$REPLICAS")

if [ "$DRY" = 1 ]; then
  say "Modo --dry-run: se renderiza el chart sin tocar el clúster"
  helm "${HELM_ARGS[@]}" --dry-run=client | grep -E '^(kind:|  host:|    - host:|          image:|    cert-manager|              - configMap)' || true
  say "OK. Nada se ha desplegado."; exit 0
fi

confirm

# El hash de la versión que está publicada ahora: sus ConfigMaps se conservan para --rollback.
PREV=$(helm get values "$RELEASE" -n "$NAMESPACE" -o json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(((JSON.parse(s)||{}).web||{}).hash||"")}catch{}})' || true)

say "Subiendo la página al clúster"
kubectl get namespace "$NAMESPACE" >/dev/null 2>&1 || kubectl create namespace "$NAMESPACE" >/dev/null
for f in "$WORK"/parts/part-*; do
  n=$((10#${f##*-}))
  CM="$RELEASE-web-$SHORT-$n"
  if kubectl -n "$NAMESPACE" get configmap "$CM" >/dev/null 2>&1; then echo "   $CM ya existe"; continue; fi
  # create (no apply): apply guardaría una copia del contenido en una anotación y pasaría del límite.
  kubectl -n "$NAMESPACE" create configmap "$CM" --from-file="$(basename "$f")=$f" >/dev/null
  kubectl -n "$NAMESPACE" label configmap "$CM" "app.kubernetes.io/name=dictaflow-site-web" \
    "app.kubernetes.io/instance=$RELEASE" "dictaflow-web=$SHORT" >/dev/null
  echo "   $CM"
done

say "Desplegando con Helm (--atomic: si falla, vuelve solo a la versión anterior)"
helm "${HELM_ARGS[@]}" --atomic --wait --timeout 3m

say "Estado"
kubectl -n "$NAMESPACE" rollout status deployment/"$RELEASE" --timeout=120s
kubectl -n "$NAMESPACE" get pods,ingress -l "app.kubernetes.io/instance=$RELEASE"

# Limpieza: solo quedan la versión nueva y la anterior.
KEEP="$SHORT ${PREV:0:12}"
for cm in $(kubectl -n "$NAMESPACE" get configmap -l "app.kubernetes.io/name=dictaflow-site-web,app.kubernetes.io/instance=$RELEASE" \
    -o jsonpath='{range .items[*]}{.metadata.name}={.metadata.labels.dictaflow-web}{"\n"}{end}'); do
  h=${cm#*=}
  [[ " $KEEP " == *" $h "* ]] || { kubectl -n "$NAMESPACE" delete configmap "${cm%%=*}" >/dev/null; echo "   borrado ${cm%%=*}"; }
done

if curl -fsS -o /dev/null -m 15 "https://$HOST/healthz" 2>/dev/null; then say "https://$HOST responde correctamente."
else say "Aún no responde https://$HOST (DNS o certificado pueden tardar unos minutos). Revisa: kubectl -n $NAMESPACE get certificate"; fi
say "Para volver atrás: ./deploy/deploy.sh --rollback"
