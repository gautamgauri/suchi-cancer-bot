# Multi-stage build for NestJS API
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

# Install dependencies for Prisma, yt-dlp, and Puppeteer
RUN apk add --no-cache \
    openssl \
    python3 \
    py3-pip \
    ffmpeg \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont && \
    pip3 install --break-system-packages yt-dlp

# Tell Puppeteer to use installed Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Install production dependencies only
COPY package.json package-lock.json* ./
# Copy Prisma schema and migrations directory (needed for migrate deploy)
COPY prisma ./prisma/

RUN npm ci --only=production && \
    npx prisma generate

# Copy built application from builder
COPY --from=builder /app/dist ./dist
# Copy scripts directory for migration and utility scripts
COPY --from=builder /app/scripts ./scripts
# Make migration script executable
RUN chmod +x /app/scripts/migrate-with-repair.sh

# Expose port (Cloud Run uses PORT env var, default 8080)
EXPOSE 8080

# Set environment to production
ENV NODE_ENV=production

# Start the application
CMD ["node", "dist/main.js"]



















