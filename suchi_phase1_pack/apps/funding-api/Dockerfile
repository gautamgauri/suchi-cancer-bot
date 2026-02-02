# suchi_phase1_pack/apps/funding-api/Dockerfile
# Three-stage: deps (prod only), build (TS → dist), runner. Matches Nest build/run; Cloud Run uses PORT=8080.

FROM node:20-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
# Cloud Run sets PORT; we default to 8080 for safety
ENV PORT=8080

# Only copy what we need
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

EXPOSE 8080
CMD ["node", "dist/main.js"]
