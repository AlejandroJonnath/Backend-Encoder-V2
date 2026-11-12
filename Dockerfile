FROM node:22-bookworm-slim

# Definir entorno de producción
# PUPPETEER_EXECUTABLE_PATH apunta al Chromium del sistema para Motor 3 (fallback HTML→PDF)
ENV NODE_ENV=production \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    SAL_USE_VCLPLUGIN=headless \
    DISPLAY=

# Instalar dependencias del sistema:
# - LibreOffice (Motor 1 de máxima fidelidad): conversión idéntica de Word/PPT/Excel a PDF en Linux
# - Chromium (Motor fallback): renderizado HTML→PDF via Puppeteer
# - Ghostscript: compresión y manipulación de PDFs
# - Fuentes tipográficas: sustituciones métricas exactas para Office (Calibri, Cambria, Arial, Times, Google Fonts)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ghostscript \
    libreoffice \
    libreoffice-writer \
    libreoffice-calc \
    libreoffice-impress \
    chromium \
    fonts-liberation \
    fonts-crosextra-carlito \
    fonts-crosextra-caladea \
    fonts-dejavu-core \
    fonts-noto \
    fonts-noto-cjk \
    fontconfig \
    curl \
    unzip \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Descargar e instalar tipografías de Google Fonts utilizadas en presentaciones (DM Sans, Archivo Black, Roboto)
RUN mkdir -p /usr/share/fonts/truetype/google-fonts \
    && curl -sSL -o /tmp/dmsans.zip "https://fonts.google.com/download?family=DM%20Sans" \
    && unzip -q /tmp/dmsans.zip -d /usr/share/fonts/truetype/google-fonts/ || true \
    && curl -sSL -o /tmp/archivoblack.zip "https://fonts.google.com/download?family=Archivo%20Black" \
    && unzip -q /tmp/archivoblack.zip -d /usr/share/fonts/truetype/google-fonts/ || true \
    && rm -f /tmp/*.zip \
    && fc-cache -f -v

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

CMD ["node", "--max-old-space-size=512", "src/app.js"]
