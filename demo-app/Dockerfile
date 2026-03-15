# ── Stage 1: build frontend ────────────────────────────────────────────────────
FROM node:20-alpine AS frontend-build
WORKDIR /app
COPY package*.json ./
# Install crust-middleware from local path — copy it first
COPY ../crust-middleware /crust-middleware
RUN npm install
COPY . .
RUN npm run build

# ── Stage 2: production server ─────────────────────────────────────────────────
FROM node:20-alpine AS server
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
COPY ../crust-middleware /crust-middleware
RUN npm install --omit=dev

# Compiled server JS
COPY --from=frontend-build /app/dist ./dist
# Built frontend assets
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

EXPOSE 3000
CMD ["node", "dist/server/index.js"]
