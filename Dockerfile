# Build context is the Aider/ workspace root, not backend/.
# The backend depends on the `aider-core` workspace package, so a build that
# starts inside backend/ cannot resolve its imports.
FROM node:20-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY core/package.json ./core/
COPY cli/package.json ./cli/
COPY backend/package.json ./backend/
RUN npm ci

COPY core ./core
COPY backend ./backend
RUN npm run build -w aider-core && npm run build -w gitstory-backend

FROM node:20-slim
WORKDIR /app

COPY package.json package-lock.json ./
COPY core/package.json ./core/
COPY cli/package.json ./cli/
COPY backend/package.json ./backend/
RUN npm ci --omit=dev

COPY --from=builder /app/core/dist ./core/dist
COPY --from=builder /app/backend/dist ./backend/dist
COPY docs ./docs

EXPOSE 8085
CMD ["node", "backend/dist/server.js"]
