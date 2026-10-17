#!/usr/bin/env bash
# Despliega / actualiza la web de DictaFlow en el clúster:
#   construye la imagen → la sube al registro → helm upgrade --install → espera a que esté lista.
#
#   ./deploy/deploy.sh             # construir, subir y desplegar (pide confirmación)
#   ./deploy/deploy.sh -y          # sin confirmación
#   ./deploy/deploy.sh --dry-run   # solo muestra lo que se desplegaría; no construye ni toca el clúster
#   ./deploy/deploy.sh --no-build  # redespliega una imagen que ya existe (TAG=<etiqueta>)
#   ./deploy/deploy.sh --rollback  # vuelve a la revisión anterior
#
# Variables (todas opcionales):
#   NAMESPACE=dictaflow  RELEASE=dictaflow-site  HOST=dictaflow.iguzman.com.mx
#   REGISTRY=ghcr.io/gmr027  TAG=<etiqueta>  INGRESS_CLASS=nginx  CLUSTER_ISSUER=letsencrypt-prod
#   REPLICAS=2  KUBE_CONTEXT=<contexto de kubectl>
set -euo pipefail

cd "$(dirname "$0")/.."

NAMESPACE=${NAMESPACE:-dictaflow}
RELEASE=${RELEASE:-dictaflow-site}
HOST=${HOST:-dictaflow.iguzman.com.mx}
REGISTRY=${REGISTRY:-ghcr.io/gmr027}
INGRESS_CLASS=${INGRESS_CLASS:-nginx}
CLUSTER_ISSUER=${CLUSTER_ISSUER:-letsencrypt-prod}
REPLICAS=${REPLICAS:-2}
IMAGE="$REGISTRY/dictaflow-site"
CHART=deploy/helm/dictaflow-site
REPO_SLUG=GMR027/dictaflow

ASSUME_YES=0 DRY=0 BUILD=1 ROLLBACK=0
for a in "$@"; do
  case "$a" in
    -y|--yes) ASSUME_YES=1 ;;
    --dry-run) DRY=1 ;;
    --no-build) BUILD=0 ;;
    --rollback) ROLLBACK=1 ;;
    -h|--help) sed -n '2,15p' "$0"; exit 0 ;;
    *) echo "Opción desconocida: $a" >&2; exit 2 ;;
  esac
done

say()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "Falta '$1' en el PATH."; }

need helm; need kubectl
[ "$BUILD" = 1 ] && [ "$DRY" = 0 ] && [ "$ROLLBACK" = 0 ] && need docker

# Un clúster equivocado es el error más caro: se muestra y se confirma siempre
[ -n "${KUBE_CONTEXT:-}" ] && kubectl config use-context "$KUBE_CONTEXT" >/dev/null
CTX=$(kubectl config current-context)
SERVER=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}')

if [ -n "${TAG:-}" ]; then :; elif git rev-parse --short HEAD >/dev/null 2>&1; then
  TAG=$(git rev-parse --short HEAD); [ -n "$(git status --porcelain)" ] && TAG="$TAG-dirty-$(date +%H%M%S)"
else TAG=$(date +%Y%m%d%H%M%S); fi

say "Clúster:    $CTX ($SERVER)"
say "Namespace:  $NAMESPACE   Release: $RELEASE"
say "Imagen:     $IMAGE:$TAG"
say "URL:        https://$HOST"

confirm() { [ "$ASSUME_YES" = 1 ] || { read -r -p "¿Continuar? [s/N] " r; [[ "$r" =~ ^[sSyY]$ ]] || die "Cancelado."; }; }

if [ "$ROLLBACK" = 1 ]; then
  confirm
  helm history "$RELEASE" -n "$NAMESPACE" --max 5
  helm rollback "$RELEASE" -n "$NAMESPACE" --wait --timeout 3m
  say "Rollback hecho."; exit 0
fi

HELM_ARGS=(upgrade --install "$RELEASE" "$CHART" -n "$NAMESPACE" --create-namespace
  --set "image.repository=$IMAGE" --set "image.tag=$TAG"
  --set "ingress.host=$HOST" --set "ingress.className=$INGRESS_CLASS"
  --set "ingress.tls.clusterIssuer=$CLUSTER_ISSUER" --set "replicaCount=$REPLICAS")

if [ "$DRY" = 1 ]; then
  say "Modo --dry-run: se renderiza el chart sin construir ni tocar el clúster"
  helm "${HELM_ARGS[@]}" --dry-run=client | grep -E '^(kind:|  host:|    - host:|          image:|    cert-manager)' || true
  say "OK. Nada se ha desplegado."; exit 0
fi

confirm

if [ "$BUILD" = 1 ]; then
  say "Descargando sumas SHA-256 de la última release (si existe)"
  curl -fsSL -o SHA256SUMS.txt "https://github.com/$REPO_SLUG/releases/latest/download/SHA256SUMS.txt" || : > SHA256SUMS.txt
  say "Construyendo imagen"
  docker build -f deploy/Dockerfile -t "$IMAGE:$TAG" .
  rm -f SHA256SUMS.txt
  say "Subiendo imagen (si falla: docker login ${REGISTRY%%/*})"
  docker push "$IMAGE:$TAG"
fi

say "Desplegando con Helm (--atomic: si falla, vuelve solo a la versión anterior)"
helm "${HELM_ARGS[@]}" --atomic --wait --timeout 3m

say "Estado"
kubectl -n "$NAMESPACE" rollout status deployment/"$RELEASE" --timeout=120s
kubectl -n "$NAMESPACE" get pods,ingress -l "app.kubernetes.io/instance=$RELEASE"

if curl -fsS -o /dev/null -m 15 "https://$HOST/healthz" 2>/dev/null; then say "https://$HOST responde correctamente."
else say "Aún no responde https://$HOST (DNS o certificado pueden tardar unos minutos). Revisa: kubectl -n $NAMESPACE get certificate"; fi
say "Para volver atrás: ./deploy/deploy.sh --rollback"
