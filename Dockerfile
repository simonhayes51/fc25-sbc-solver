# Dockerfile
FROM node:22-bullseye

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@9.7.0 --activate

WORKDIR /app

# Copy only package.json and package-lock.json first (for caching)
COPY package.json package-lock.json* ./

# Install dependencies with pnpm (ignores corrupt npm cache issues)
RUN pnpm install --prod --no-frozen-lockfile

# Copy rest of the source
COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
