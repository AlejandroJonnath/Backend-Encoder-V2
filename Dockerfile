FROM node:20-bullseye-slim

# Definir entorno de producción
# PUPPETEER_EXECUTABLE_PATH apunta al Chromium del sistema para Motor 3 (fallback HTML→PDF)
ENV NODE_ENV=production \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Instalar dependencias del sistema:
# - LibreOffice (Motor 2): conversión fiel de Word/PPT/Excel a PDF en Linux
# - Chromium (Motor 3 fallback): renderizado HTML→PDF via Puppeteer cuando LibreOffice falla
# - Ghostscript: compresión y manipulación de PDFs
# - Fuentes tipográficas: necesarias para LibreOffice y renderizado HTML correcto
RUN apt-get update && apt-get install -y --no-install-recommends \
    ghostscript \
    libreoffice \
    libreoffice-writer \
    libreoffice-calc \
    libreoffice-impress \
    chromium \
    fonts-liberation \
    fonts-dejavu-core \
    fonts-noto \
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
