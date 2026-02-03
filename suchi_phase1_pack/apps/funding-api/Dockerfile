# suchi_phase1_pack/apps/funding-api/Dockerfile
# Two-stage build: build (compile TS + generate Prisma), runner (minimal runtime)

FROM node:20-slim AS build
WORKDIR /app

# Install OpenSSL for Prisma
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Install all dependencies (including devDeps for build)
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci

# Generate Prisma client
RUN npx prisma generate

# Build TypeScript
COPY . .
RUN npm run build

# Prune dev dependencies for smaller image
RUN npm prune --omit=dev

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

# Install OpenSSL for Prisma runtime
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Install Prisma CLI globally for migrations (pinned to v5.x to match project)
RUN npm install -g prisma@5.20.0

# Copy pruned node_modules (production only) with generated Prisma client
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma

EXPOSE 8080
CMD ["node", "dist/main.js"]
