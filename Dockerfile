FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Copy source code and build
COPY tsconfig.json tsconfig.tsbuildinfo ./
COPY src/ ./src/
RUN npm run build

# Production image
FROM node:20-alpine AS production

WORKDIR /app
ENV NODE_ENV=production

# Copy built artifacts and production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# Create a non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3000
CMD ["node", "dist/server.js"]
