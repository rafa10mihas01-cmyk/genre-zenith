# Imagem oficial Playwright (Chromium + libs já instalados, evita install --with-deps)
FROM mcr.microsoft.com/playwright:v1.47.2-jammy

ENV NODE_ENV=production \
    PLAYWRIGHT_HEADLESS=true \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

# Dependências primeiro (cache)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev || npm install --omit=dev --no-package-lock

# Código
COPY src ./src
COPY ecosystem.config.cjs ./

# PM2 global (runtime supervisor)
RUN npm install -g pm2@5

# Diretórios runtime
RUN mkdir -p /app/logs /opt/nexengine/secrets

EXPOSE 8787

# Healthcheck Docker bate no endpoint local /health
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.HEALTHCHECK_PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# pm2-runtime mantém os processos no foreground (modo container)
CMD ["pm2-runtime", "start", "ecosystem.config.cjs"]
