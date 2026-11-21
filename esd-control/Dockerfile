# Imagen de producción de ESD Control (usada por Railway; sirve para cualquier plataforma con Docker).
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Se instalan también las dependencias de desarrollo: tsx ejecuta las migraciones y el alta del administrador
RUN npm ci --no-audit --no-fund

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    STORAGE_DIR=/data/storage
COPY --from=build /app ./
# Punto de montaje del volumen persistente (planos, fotos, documentos)
RUN mkdir -p /data/storage
EXPOSE 3000
CMD ["npm", "start"]
