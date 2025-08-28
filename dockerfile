# Dockerfile
FROM node:22-bullseye

# Use pnpm instead of npm to avoid EINTEGRITY loop
RUN corepack enable && corepack prepare pnpm@9.7.0 --activate

ENV NODE_ENV=production \
    NODE_OPTIONS=--dns-result-order=ipv4first

WORKDIR /app

# Install only production deps first (better caching)
COPY package.json ./
# if you later add a pnpm-lock.yaml, copy it too for deterministic builds:
# COPY package.json pnpm-lock.yaml ./

# Install prod deps (no lockfile required right now)
RUN pnpm install --prod --no-frozen-lockfile --reporter=silent

# Copy the rest of the app
COPY . .

EXPOSE 3000
CMD ["node", "server.js"]