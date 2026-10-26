FROM node:20-bullseye-slim

# Definir entorno de producción
ENV NODE_ENV=production \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Instalar dependencias del sistema: Ghostscript, LibreOffice, fuentes tipográficas y curl para healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    ghostscript \
    libreoffice \
    libreoffice-writer \
    libreoffice-calc \
    libreoffice-impress \
    fonts-liberation \
    fonts-dejavu-core \
    fontconfig \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instalar dependencias de producción únicamente
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copiar el código fuente de la aplicación (los secretos y temporales están excluidos vía .dockerignore)
COPY . .

# Crear directorio de temporales y asignar permisos al usuario 'node'
RUN mkdir -p /app/temp_uploads && chown -R node:node /app

# Volumen para archivos temporales pesados de hasta 2GB (evita saturar el overlay del contenedor)
VOLUME ["/app/temp_uploads"]

# Ejecutar como usuario no privilegiado por seguridad
USER node

EXPOSE 3000

# Verificación de salud del contenedor
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/salud || exit 1

CMD ["node", "src/app.js"]
