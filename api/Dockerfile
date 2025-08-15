# --- deps ---
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# --- build ---
FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig*.json ./
COPY src ./src
# ensure you have "build": "tsc -p tsconfig.json" in api/package.json
RUN npm run build

# --- runtime ---
FROM node:20-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist
COPY prisma ./prisma
COPY .env.prod ./.env

# Run migrations on start, then boot the server.
# If your build outputs to dist/src/server.js, keep that path.
CMD sh -c "npx prisma migrate deploy && node dist/src/server.js"