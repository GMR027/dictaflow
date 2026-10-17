# Web estática de DictaFlow: etapa 1 genera el HTML (bilingüe), etapa 2 lo sirve con nginx sin privilegios.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
COPY site ./site
# SHA256SUMS.txt lo descarga el workflow (puede estar vacío). En local: touch SHA256SUMS.txt
COPY SHA256SUMS.txt ./
ENV CHECKSUMS=/app/SHA256SUMS.txt
RUN node site/build.mjs

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/site/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
