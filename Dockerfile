# ============================================================================
# MULTI-STAGE PRODUCTION DOCKERFILE
# ============================================================================
# 
# Strategy:
# - Build stage: Compile TypeScript, install dependencies
# - Runtime stage: Minimal image with only production dependencies
# - Size optimization: node:20-alpine (~150MB vs 900MB+ for node:20)
# - Security: Non-root user, minimal attack surface
#
# Build Time: ~3-5 minutes
# Final Image Size: ~250-350MB
# ============================================================================

# ============================================================================
# STAGE 1: BUILDER
# ============================================================================
FROM node:20-alpine AS builder

# Install build dependencies (build-essential not needed on Alpine)
RUN apk add --no-cache python3 make g++ git

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies with pnpm (faster than npm, more reliable)
# Using --frozen-lockfile ensures reproducible builds
RUN npm install -g pnpm && \
    pnpm install --frozen-lockfile

# Copy entire source code
COPY . .

# Build the NestJS application
RUN pnpm run build

# ============================================================================
# STAGE 2: RUNTIME
# ============================================================================
FROM node:20-alpine

# Set environment to production (disables dev tools in NestJS)
ENV NODE_ENV=production

# Install runtime dependencies only (postgresql client for prisma)
RUN apk add --no-cache \
    postgresql-client \
    dumb-init

# Set working directory
WORKDIR /app

# Copy package files from builder
COPY package.json pnpm-lock.yaml ./

# Install production dependencies only with pnpm
# --prod flag excludes devDependencies
RUN npm install -g pnpm && \
    pnpm install --frozen-lockfile --prod && \
    pnpm cache clean

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Copy Prisma schema and migrations (required for migrations)
COPY --from=builder /app/prisma ./prisma

# Create non-root user for security best practices
# Prevents potential container escape vulnerabilities
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Change ownership of app directory to nodejs user
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose application port
EXPOSE 3000

# Health check (optional but recommended for orchestration)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# ============================================================================
# STARTUP SEQUENCE
# ============================================================================
# 
# 1. dumb-init ensures proper signal handling (SIGTERM → graceful shutdown)
# 2. Prisma migrations run automatically before app starts
# 3. Prevents zombie processes
# 4. Handles Docker STOP signal correctly
#
# Without dumb-init:
# - Node process ignores SIGTERM
# - Container waits 10s then SIGKILL (unclean shutdown)
# - Potential data corruption with databases
#
# With dumb-init:
# - SIGTERM → SIGTERM to Node → graceful shutdown
# - Clean database connections
# - No data loss
#
# ============================================================================
ENTRYPOINT ["/sbin/dumb-init", "--"]

CMD [ \
    "sh", "-c", \
    "npx prisma migrate deploy --skip-generate && node dist/main" \
    ]

# ============================================================================
# ALTERNATIVE STARTUP (if using Railway/Render with built-in migration)
# ============================================================================
# If your deployment platform runs migrations automatically:
#
# CMD ["node", "dist/main"]
#
# But recommended to include migrations in Dockerfile for portability
# ============================================================================
