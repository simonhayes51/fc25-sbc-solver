# Dockerfile
FROM node:22-slim

ENV NODE_ENV=production \
    NPM_CONFIG_CACHE=/root/.npm \
    NPM_CONFIG_PREFER_ONLINE=true \
    NPM_CONFIG_FOREGROUND_SCRIPTS=false \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_STRICT_SSL=true \
    NPM_CONFIG_FETCH_RETRIES=5 \
    NPM_CONFIG_FETCH_RETRY_FACTOR=2 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=2000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=60000 \
    NODE_OPTIONS=--dns-result-order=ipv4first

WORKDIR /app

# Install only prod deps first (better layer caching)
COPY package*.json ./
RUN npm cache clean --force || true \
 && rm -rf /root/.npm/_cacache || true \
 && npm config set registry https://registry.npmjs.org/ \
 && npm install --omit=dev --no-audit --no-fund --prefer-online

# Copy the rest of the app
COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
