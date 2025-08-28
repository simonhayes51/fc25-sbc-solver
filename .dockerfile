# Dockerfile - Fixed for npm integrity issues
FROM node:18-alpine

# Install system dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    && rm -rf /var/cache/apk/*

WORKDIR /app

# Copy package files first
COPY package*.json ./

# Clear npm cache and configure npm for better reliability
RUN npm config set registry https://registry.npmjs.org/ && \
    npm config set fund false && \
    npm config set audit false && \
    npm cache clean --force

# Install dependencies with fallback strategies
RUN npm install --production --no-optional --prefer-online || \
    (npm cache clean --force && npm install --production --no-optional --prefer-online) || \
    (rm -rf node_modules package-lock.json && npm install --production --no-optional --no-package-lock)

# Copy source code
COPY . .

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Change ownership
RUN chown -R nodejs:nodejs /app
USER nodejs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

# Start application
CMD ["node", "server.js"]
