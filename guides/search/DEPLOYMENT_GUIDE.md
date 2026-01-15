# Production Deployment Guide: dev-share-lite Backend

## Overview

This guide provides **step-by-step instructions** to deploy the NestJS backend with semantic search (pgvector) and Redis caching to **Railway** or any Docker-compatible platform.

### Key Features Deployed

- ✅ **Semantic Search**: pgvector embeddings with OpenAI API
- ✅ **Vector Caching**: Redis for search result caching (30 min TTL)
- ✅ **Database Migrations**: Auto-run on startup
- ✅ **Production Optimization**: Multi-stage Docker build, non-root user
- ✅ **Health Checks**: Built-in endpoint monitoring
- ✅ **Signal Handling**: Graceful shutdown with dumb-init

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Local Testing with Docker](#local-testing)
3. [Railway Deployment](#railway-deployment)
4. [Environment Configuration](#environment-configuration)
5. [Database Setup](#database-setup)
6. [Monitoring & Debugging](#monitoring)
7. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Accounts

- **Railway** account (free tier available): https://railway.app
- **OpenAI** account for embeddings API: https://platform.openai.com
- **GitHub** account (for Railway integration)

### Required Tools (Local Testing Only)

- **Docker**: v20+ (https://www.docker.com/products/docker-desktop)
- **Docker Compose**: v2+ (included with Docker Desktop)
- **Node.js**: v20 LTS (for local development)
- **pnpm**: v8+ (`npm install -g pnpm`)

### Required Environment Variables

```
DATABASE_URL=postgresql://user:password@localhost:5432/devshare
REDIS_URL=redis://localhost:6379
OPENAI_API_KEY=sk-...
JWT_SECRET=your-secret-key
JWT_REFRESH_SECRET=your-refresh-secret
CLOUDINARY_NAME=your-cloudinary-name
CLOUDINARY_API_KEY=your-key
CLOUDINARY_API_SECRET=your-secret
```

---

## Local Testing with Docker

### Step 1: Build the Docker Image

```bash
cd d:\saves\Fullstack\Project\dev-share-lite-be

# Build the production Docker image
docker build -t dev-share-lite-be:latest .

# Verify the image was built
docker images | grep dev-share-lite-be
```

**Expected Output:**

```
REPOSITORY              TAG       IMAGE ID       CREATED      SIZE
dev-share-lite-be       latest    abc12def3456   2 hours ago  287MB
```

### Step 2: Test with Docker Compose (Local Database + Redis)

Update or create `docker-compose.prod.yml`:

```yaml
version: '3.8'

services:
  db:
    image: ankane/pgvector:latest
    platform: linux/amd64
    container_name: devshare_postgres_prod
    restart: always
    ports:
      - '5432:5432'
    environment:
      POSTGRES_USER: ${DB_USER:-postgres}
      POSTGRES_PASSWORD: ${DB_PASSWORD:-password}
      POSTGRES_DB: ${DB_NAME:-devshare}
    volumes:
      - pgdata_prod:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U ${DB_USER:-postgres}']
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: devshare_redis_prod
    restart: always
    ports:
      - '6379:6379'
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 10s
      timeout: 5s
      retries: 5

  app:
    build: .
    container_name: devshare_app_prod
    restart: always
    ports:
      - '3000:3000'
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://${DB_USER:-postgres}:${DB_PASSWORD:-password}@db:5432/${DB_NAME:-devshare}
      REDIS_URL: redis://redis:6379
      OPENAI_API_KEY: ${OPENAI_API_KEY}
      JWT_SECRET: ${JWT_SECRET}
      JWT_REFRESH_SECRET: ${JWT_REFRESH_SECRET}
      CLOUDINARY_NAME: ${CLOUDINARY_NAME}
      CLOUDINARY_API_KEY: ${CLOUDINARY_API_KEY}
      CLOUDINARY_API_SECRET: ${CLOUDINARY_API_SECRET}
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test:
        [
          'CMD',
          'node',
          '-e',
          "require('http').get('http://localhost:3000/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})",
        ]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s
    volumes:
      - .env.production:/app/.env:ro

volumes:
  pgdata_prod:
  redis_data:
```

### Step 3: Run Containers

```bash
# Create .env.production file
cat > .env.production << 'EOF'
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=devshare
OPENAI_API_KEY=sk-your-key-here
JWT_SECRET=your-jwt-secret-here
JWT_REFRESH_SECRET=your-jwt-refresh-secret-here
CLOUDINARY_NAME=your-cloudinary-name
CLOUDINARY_API_KEY=your-cloudinary-api-key
CLOUDINARY_API_SECRET=your-cloudinary-api-secret
EOF

# Start all services
docker-compose -f docker-compose.prod.yml up --build

# Expected logs:
# - Database migration: "Running 1 migration against database..."
# - App startup: "Nest application successfully started on port 3000"
# - Health check: "GET /health 200 in 2ms"
```

### Step 4: Test Endpoints

```bash
# Check health
curl http://localhost:3000/health

# Create a test post
curl -X POST http://localhost:3000/posts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "title": "Test Post",
    "content_markdown": "This is a test post about NestJS and semantic search",
    "tags": ["nestjs", "search"]
  }'

# Search posts (semantic)
curl "http://localhost:3000/posts/search/semantic?query=javascript+framework&limit=5"

# Verify embedding generation
# Check logs for: "[EMBEDDING] Found X results for query: ..."
```

### Step 5: Cleanup

```bash
# Stop containers
docker-compose -f docker-compose.prod.yml down

# Remove volumes (careful: loses data)
docker-compose -f docker-compose.prod.yml down -v

# Remove unused images
docker image prune -a
```

---

## Railway Deployment

### Step 1: Prepare Repository

```bash
# Ensure all changes are committed
git add .
git commit -m "feat: add semantic search with pgvector and production dockerfile"

# Push to GitHub
git push origin feature/search
```

### Step 2: Create Railway Project

1. **Login to Railway**: https://railway.app/dashboard
2. **Create New Project**
3. **Connect GitHub Repository**
   - Click "Import from GitHub"
   - Select your `dev-share-lite-be` repository
   - Authorize Railway access
4. **Wait for project creation** (1-2 minutes)

### Step 3: Add Services

#### Add PostgreSQL Database with pgvector

```bash
# In Railway Dashboard:
1. Click "Add Services"
2. Select "PostgreSQL"
3. Copy the DATABASE_URL from the service config
4. Note: Railway's PostgreSQL doesn't include pgvector by default
   - Solution: Use custom image or create extension manually
```

**Better Approach: Use Neon (pgvector included)**

If Railway's PostgreSQL doesn't have pgvector:

1. Create free Neon account: https://neon.tech
2. Create PostgreSQL database with pgvector enabled
3. Copy connection string (includes all required config)
4. Add to Railway environment: `DATABASE_URL=postgresql://...`

#### Add Redis

```bash
# In Railway Dashboard:
1. Click "Add Services"
2. Select "Redis"
3. Copy REDIS_URL from service variables
```

### Step 4: Configure Environment Variables

In Railway Dashboard → Project Settings → Variables:

```
NODE_ENV=production

# Database (from PostgreSQL or Neon)
DATABASE_URL=postgresql://user:pass@host:5432/dbname

# Redis
REDIS_URL=redis://default:pass@host:port

# OpenAI API
OPENAI_API_KEY=sk-...

# Auth Secrets
JWT_SECRET=your-secure-random-string-32-chars
JWT_REFRESH_SECRET=your-secure-random-string-32-chars

# Cloudinary
CLOUDINARY_NAME=your-name
CLOUDINARY_API_KEY=your-key
CLOUDINARY_API_SECRET=your-secret
```

**Generate secure secrets:**

```bash
# Generate 32-char random string
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

### Step 5: Deploy

```bash
# In Railway Dashboard:
1. Go to "Deployments" tab
2. Click "Deploy" or it auto-deploys on push
3. Monitor logs in real-time
4. Wait for "Deployment Successful" message
```

**Expected Logs:**

```
Starting deployment...
Building image from Dockerfile...
Step 1/25: FROM node:20-alpine AS builder
[stages...]
Successfully built image
Pushing to registry...
Starting container...
Running: npx prisma migrate deploy --skip-generate
Running 1 migration against database
Migration applied successfully
Nest application successfully started
App is listening on http://0.0.0.0:3000
```

### Step 6: Access Your App

```bash
# Railway generates a public URL (example)
# https://dev-share-lite-be-production-abc123.railway.app

# Test health endpoint
curl https://dev-share-lite-be-production-abc123.railway.app/health

# Test semantic search
curl "https://dev-share-lite-be-production-abc123.railway.app/posts/search/semantic?query=typescript"
```

---

## Environment Configuration

### Production Checklist

- [ ] `NODE_ENV=production` (disables debug logging)
- [ ] `DATABASE_URL` points to production DB
- [ ] `REDIS_URL` points to production Redis
- [ ] `OPENAI_API_KEY` is valid and has credit
- [ ] `JWT_SECRET` and `JWT_REFRESH_SECRET` are unique, 32+ chars
- [ ] `CLOUDINARY_*` credentials are configured
- [ ] Database has pgvector extension enabled
- [ ] Prisma migrations have run successfully

### OpenAI API Cost Estimation

For text-embedding-3-small:

- **Cost**: $0.02 per 1M tokens
- **Average post**: ~500 tokens
- **Cost per search**: ~$0.00001
- **10,000 searches/month**: ~$0.10

**With Redis caching (30 min TTL)**:

- If 80% cache hit rate: ~$0.02/month
- Recommended: Monitor API usage in OpenAI dashboard

### Scaling Considerations

**Single Instance (Current)**

- Suitable for: <10K daily active users
- Limitations: Single point of failure, no auto-recovery
- Cost: ~$5-10/month on Railway

**Production Grade (Recommended)**

```yaml
# Multiple replicas (horizontal scaling)
replicas: 3

# Load balancer: Railway handles automatically
# Database: Connection pooling (PgBouncer)
#   - Recommended: Neon's built-in pooling
#   - Settings: 25 connections per replica
# Redis: Cluster mode for high throughput
#   - Recommended: Redis Cloud
#   - Cost: ~$15-30/month for scaling
```

---

## Database Setup

### Automatic Migrations (Recommended)

The Dockerfile automatically runs:

```bash
npx prisma migrate deploy --skip-generate
```

Before starting the app. This:

1. ✅ Applies all pending migrations
2. ✅ Enables pgvector extension
3. ✅ Creates HNSW index on embeddings
4. ✅ Initializes all tables

### Manual Migration (if needed)

```bash
# Connect to production database
DATABASE_URL="postgresql://..." npx prisma migrate deploy

# View migration status
DATABASE_URL="postgresql://..." npx prisma migrate status

# View applied migrations
DATABASE_URL="postgresql://..." npx prisma migrate resolve --applied 20260115000000_add_pgvector_embeddings
```

### Verify pgvector is Enabled

```bash
# Connect to PostgreSQL
psql "$DATABASE_URL"

# Check extension
SELECT * FROM pg_extension WHERE extname = 'vector';

# Expected: one row with 'vector' extension

# Check HNSW index exists
\d posts

# Look for: idx_posts_embedding_hnsw  | index | public

exit
```

---

## Monitoring & Debugging

### Railway Logs

```bash
# In Railway Dashboard:
1. Go to "Deployments" → Select deployment
2. Click "View Logs"
3. Real-time logs show app output

# Search for:
# [SEARCH] - Semantic search operations
# [EMBEDDING] - Embedding generation
# [CACHE] - Redis caching
```

### Check Service Health

```bash
# Health endpoint
curl https://your-app.railway.app/health

# Expected: 200 OK with health data
```

### OpenAI API Monitoring

```bash
# Monitor token usage in OpenAI dashboard
https://platform.openai.com/usage/overview

# Set up usage alerts:
1. Go to Organization → Billing settings
2. Set monthly budget limit
3. Enable email alerts
```

### Database Performance

```bash
# Connect to production DB
DATABASE_URL="postgresql://..." psql

# Check index usage
SELECT * FROM pg_stat_user_indexes WHERE schemaname = 'public';

# Check slow queries
SELECT * FROM pg_stat_statements ORDER BY mean_time DESC LIMIT 5;

exit
```

---

## Troubleshooting

### Issue: "Embedding extension not found"

```
Error: type "vector" does not exist
```

**Solution**:

```bash
# Manually enable extension
DATABASE_URL="postgresql://..." psql -c "CREATE EXTENSION IF NOT EXISTS vector;"

# Or run migration
DATABASE_URL="postgresql://..." npx prisma migrate deploy
```

### Issue: "OPENAI_API_KEY not configured"

```
[EMBEDDING] OPENAI_API_KEY not set, using mock embedding
```

**Solution**:

1. Get API key: https://platform.openai.com/api-keys
2. Add to Railway environment: `OPENAI_API_KEY=sk-...`
3. Re-deploy

### Issue: "Search returns no results"

**Likely cause**: Posts don't have embeddings yet

**Solution**:

```bash
# Manually generate embeddings for all posts
# Create a CLI command (or run via Node REPL)

# Option 1: Via NestJS CLI
npm run build
node -e "
  const { PostsService } = require('./dist/posts/posts.service');
  const service = new PostsService(...);
  service.generateEmbeddingsForAllPosts().then(console.log);
"

# Option 2: Via Prisma Studio (manual)
npx prisma studio
# Navigate to posts → Update → Add embedding
```

### Issue: "Deployment times out at migration step"

```
Waiting for migrations... (timeout after 60s)
```

**Solution**:

1. Check database connectivity:

   ```bash
   psql "$DATABASE_URL" -c "SELECT 1;"
   ```

2. If failed, verify `DATABASE_URL` in Railway:
   - Go to PostgreSQL service
   - Copy fresh connection string
   - Update Railway environment

3. Increase timeout in Dockerfile:

   ```dockerfile
   # Modify CMD timeout
   CMD ["sh", "-c", "timeout 300 npx prisma migrate deploy && node dist/main"]
   ```

4. Re-deploy

### Issue: "Redis connection refused"

```
Error: connect ECONNREFUSED 127.0.0.1:6379
```

**Solution**:

1. Verify Redis is running:

   ```bash
   redis-cli ping
   # Expected: PONG
   ```

2. Check `REDIS_URL` environment variable:

   ```bash
   echo $REDIS_URL
   # Expected: redis://user:pass@host:port
   ```

3. If using Railway, ensure Redis service is running:
   - Dashboard → Services → Redis → Active

4. Update app config if needed:
   ```typescript
   // src/redis/redis.service.ts
   // Verify connection string is correct
   ```

### Issue: "Prisma generate command failed"

```
Error: prisma generate failed
```

**Solution**: The Dockerfile uses `--skip-generate` to avoid this:

```dockerfile
npx prisma migrate deploy --skip-generate
```

If you need to regenerate:

```bash
# Run locally
npx prisma generate

# Commit changes
git add prisma/generated
git commit -m "chore: regenerate prisma types"
```

---

## Performance Tuning

### Vector Search Optimization

```typescript
// Current: Top 5 posts
const limit = 5;

// Tune based on metrics:
// - If latency > 1s: Reduce limit to 3
// - If results too few: Increase limit to 10
// - Monitor cache hit rate: Target 80%+
```

### Cache Tuning

```typescript
// Current: 30 minutes (1800 seconds)
await this.redis.set(cacheKey, JSON.stringify(results), 1800);

// Production options:
// - High traffic: 60 minutes (3600s) - less fresh but cheaper
// - Low traffic: 10 minutes (600s) - more fresh
// - User-specific: 5 minutes (300s) - lowest latency
```

### Index Tuning

```sql
-- Current HNSW index parameters
m = 16        -- Connections per node (higher = better quality, slower)
ef_construction = 64  -- Construction parameter

-- Tuning options:
m = 32, ef_construction = 128  -- Better quality, slower ingestion
m = 8, ef_construction = 32    -- Faster ingestion, lower quality

-- Measure performance:
EXPLAIN ANALYZE
SELECT id FROM posts
ORDER BY embedding <=> '[0.1, 0.2, ...]'::vector
LIMIT 5;
```

---

## Rollback Procedure

If deployment fails:

```bash
# In Railway Dashboard:
1. Go to "Deployments" tab
2. Find previous successful deployment
3. Click "Redeploy" on that deployment
4. App rolls back to previous version
5. Check logs for errors
```

---

## Support & Resources

- **Railway Docs**: https://docs.railway.app
- **NestJS Docs**: https://docs.nestjs.com
- **Prisma Docs**: https://www.prisma.io/docs
- **pgvector Guide**: https://github.com/pgvector/pgvector
- **OpenAI API**: https://platform.openai.com/docs

---

## Summary

✅ **Deployment Steps**:

1. Build Docker image: `docker build -t app:latest .`
2. Test locally: `docker-compose -f docker-compose.prod.yml up`
3. Push to GitHub: `git push origin feature/search`
4. Connect to Railway
5. Add PostgreSQL + Redis services
6. Configure environment variables
7. Deploy (auto or manual)
8. Test health endpoint
9. Monitor logs and embeddings

✅ **Key Indicators of Success**:

- Health endpoint returns 200 OK
- Migrations run automatically on startup
- Search endpoint returns results (with or without OpenAI API)
- Redis cache logs show "Cache hit" for repeated queries
- CPU/Memory usage remains stable under load

**Estimated deployment time: 10-15 minutes**

For questions or issues, refer to the troubleshooting section or Railway support.
