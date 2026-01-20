# Database Migration Details & pgvector Setup

## Migration Information

**File**: `prisma/migrations/20260115000000_add_pgvector_embeddings/migration.sql`

**Date**: January 15, 2026

**Changes**:

- Enable pgvector extension
- Create HNSW index on embeddings
- Create composite indexes for filtering

## SQL Commands Explained

### 1. Enable pgvector Extension

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

**What it does:**

- Installs the pgvector PostgreSQL extension
- Enables vector data type support
- Required for `Unsupported("vector(768)")` in Prisma schema

**Prerequisites:**

- PostgreSQL 10+
- pgvector extension must be available
- Railway's default PostgreSQL doesn't include it - use Neon instead

**Verify installation:**

```bash
# Connect to your database
psql "$DATABASE_URL"

# Check if extension exists
SELECT * FROM pg_extension WHERE extname = 'vector';

# Expected output: One row with 'vector'
# If empty, extension not installed

exit
```

### 2. Create HNSW Index

```sql
CREATE INDEX IF NOT EXISTS idx_posts_embedding_hnsw
ON "posts" USING hnsw ("embedding" vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```

**What it does:**

- Creates Hierarchical Navigable Small World (HNSW) index
- Optimized for approximate nearest neighbor search
- Enables fast vector similarity queries

**Parameters:**

| Parameter           | Value | Meaning                                        |
| ------------------- | ----- | ---------------------------------------------- |
| `m`                 | 16    | Connections per node (higher = better quality) |
| `ef_construction`   | 64    | Size of dynamic list during construction       |
| `vector_cosine_ops` | -     | Distance metric: cosine similarity             |

**Performance:**

- Index size: ~10% of embedding data
- Query time: O(log n) - logarithmic with data size
- For 1,000 posts: ~10ms query
- For 1,000,000 posts: ~50ms query

**Trade-offs:**

```
m = 16, ef_construction = 64  (CURRENT)
├─ Quality: Good (medium)
├─ Speed: Fast
├─ Memory: Moderate
└─ Ingestion: Fast

m = 8, ef_construction = 32   (FASTER, LOWER QUALITY)
├─ Quality: Lower
├─ Speed: Faster
├─ Memory: Less
└─ Ingestion: Faster

m = 32, ef_construction = 128 (SLOWER, HIGHER QUALITY)
├─ Quality: Higher
├─ Speed: Slower
├─ Memory: More
└─ Ingestion: Slower
```

### 3. Additional Indexes for Filtering

```sql
-- Composite index for soft delete + status filtering
CREATE INDEX IF NOT EXISTS idx_posts_deleted_at_status
ON "posts" ("deleted_at", "status")
WHERE "deleted_at" IS NULL;

-- Index for author + status filtering
CREATE INDEX IF NOT EXISTS idx_posts_author_id_status
ON "posts" ("author_id", "status");
```

**Why needed:**

- Vector search includes WHERE clauses
- `deleted_at IS NULL` - Exclude soft-deleted posts
- `status = 'PUBLISHED'` - Only published posts
- `author_id = X` - For user-specific queries
- Without indexes: Full table scan (slow)
- With indexes: Efficient filtering before vector search

**Index usage:**

```sql
-- Query plan with indexes
EXPLAIN ANALYZE
SELECT id FROM posts
WHERE deleted_at IS NULL AND status = 'PUBLISHED'
ORDER BY embedding <=> $1::vector
LIMIT 5;

-- Expected: Uses idx_posts_deleted_at_status index
-- Then applies HNSW on remaining rows
```

## Migration Application

### Automatic (Recommended)

The Dockerfile applies migrations automatically on startup:

```dockerfile
CMD ["sh", "-c", "npx prisma migrate deploy --skip-generate && node dist/main"]
```

**Process:**

1. Container starts
2. `npx prisma migrate deploy` runs
3. Pending migrations applied (20260115000000...)
4. App starts: `node dist/main`

**Logs:**

```
Running 1 migration against database
Applying migration: 20260115000000_add_pgvector_embeddings
Migration applied successfully
Nest application successfully started
```

### Manual

If needed for development:

```bash
# Apply pending migrations
DATABASE_URL="postgresql://..." npx prisma migrate deploy

# Check migration status
DATABASE_URL="postgresql://..." npx prisma migrate status

# Resolve (mark as applied without running)
DATABASE_URL="postgresql://..." npx prisma migrate resolve --applied 20260115000000_add_pgvector_embeddings
```

## Verification Steps

### 1. Check Extension

```bash
psql "$DATABASE_URL" -c "SELECT * FROM pg_extension WHERE extname = 'vector';"

# Expected:
# extname | extowner | extnamespace | ...
# vector  | 10       | 2200         | ...
```

### 2. Check Embedding Column

```bash
psql "$DATABASE_URL" -c "\d posts" | grep embedding

# Expected:
# embedding | vector(768) |
```

### 3. Check HNSW Index

```bash
psql "$DATABASE_URL" -c "
  SELECT schemaname, tablename, indexname, indextype
  FROM pg_indexes
  WHERE tablename = 'posts' AND indexname LIKE 'idx_posts_embedding%';
"

# Expected:
# schemaname | tablename | indexname | indextype
# public | posts | idx_posts_embedding_hnsw | hnsw
```

### 4. Check Other Indexes

```bash
psql "$DATABASE_URL" -c "
  SELECT schemaname, tablename, indexname
  FROM pg_indexes
  WHERE tablename = 'posts'
  ORDER BY indexname;
"

# Expected at least:
# idx_posts_embedding_hnsw
# idx_posts_deleted_at_status
# idx_posts_author_id_status
```

## Rollback Procedure

If migration needs to be reverted:

```bash
# View migrations
npx prisma migrate status

# Rollback specific migration
npx prisma migrate resolve --rolled-back 20260115000000_add_pgvector_embeddings

# Or manually drop:
DATABASE_URL="postgresql://..." psql -c "
  DROP INDEX IF EXISTS idx_posts_embedding_hnsw;
  DROP INDEX IF EXISTS idx_posts_deleted_at_status;
  DROP INDEX IF EXISTS idx_posts_author_id_status;
  DROP EXTENSION IF EXISTS vector;
"
```

## Performance Testing

### Benchmark Query Performance

```bash
# Connect to database
psql "$DATABASE_URL"

-- Create 100 random test posts with embeddings
INSERT INTO posts (title, slug, content_markdown, author_id, status, embedding)
SELECT
  'Test Post ' || i,
  'test-post-' || i,
  'Content ' || i,
  1,
  'PUBLISHED',
  ARRAY[
    RANDOM(), RANDOM(), RANDOM(), ...[1536 values]..., RANDOM()
  ]::vector(1536)
FROM generate_series(1, 100) i;

-- Test vector search performance
EXPLAIN ANALYZE
SELECT id, title, (embedding <=> ARRAY[0.1, 0.2, ...]::vector(1536)) as distance
FROM posts
WHERE deleted_at IS NULL AND status = 'PUBLISHED'
ORDER BY embedding <=> ARRAY[0.1, 0.2, ...]::vector(1536)
LIMIT 5;

-- Expected execution time: 5-20ms (depending on table size)
-- Look for: "Index Scan using idx_posts_embedding_hnsw"
```

### Monitor Index Usage

```sql
-- Check index efficiency
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes
WHERE tablename = 'posts'
ORDER BY idx_scan DESC;

-- High idx_scan = index being used frequently (good!)
-- Low idx_scan = index not being used (consider dropping)
```

## Prisma Schema Configuration

The embedding column is already in schema:

```prisma
model posts {
  // ... other fields

  // pgvector: 768 dimensions (or 1536 for OpenAI)
  embedding Unsupported("vector(768)")?

  // ... other fields
}
```

**Generated Prisma Client:**

```typescript
// The embedding field is available in Prisma client
const post = await prisma.posts.findUnique({
  where: { id: 1 },
  // Note: Prisma doesn't type the embedding field
  // Use prisma.$queryRaw for vector operations
});

// For vector searches, use raw SQL:
const results = await prisma.$queryRaw`
  SELECT * FROM posts
  ORDER BY embedding <=> $1::vector
  LIMIT 5
`;
```

## Integration with Node.js

### OpenAI API Integration

```typescript
// Generate embedding via OpenAI
async function generateEmbedding(text: string): Promise<number[]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: text,
    }),
  });

  const data = await response.json();
  return data.data[0].embedding; // 1536 dimensions
}

// Store in database
await prisma.posts.update({
  where: { id: postId },
  data: {
    embedding: embedding as any, // Type assertion needed
  },
});

// Query by similarity
const results = (await prisma.$queryRaw`
  SELECT id, title, embedding <=> $1::vector as distance
  FROM posts
  WHERE deleted_at IS NULL
  ORDER BY embedding <=> $1::vector
  LIMIT 5
`) as any[];
```

## Troubleshooting Migration Issues

### Issue: "Relation 'vector' does not exist"

```
Error: type "vector" does not exist
```

**Cause**: pgvector extension not enabled

**Solution**:

```bash
# Enable extension manually
DATABASE_URL="postgresql://..." psql -c "CREATE EXTENSION IF NOT EXISTS vector;"

# Then re-run migration
npx prisma migrate deploy
```

### Issue: "HNSW extension not found"

```
Error: access method "hnsw" does not exist
```

**Cause**: pgvector version too old (hnsw added in pgvector 0.5+)

**Solution**:

```bash
# Use latest pgvector (0.7+)
# On Railway: Not available by default - use Neon instead
# On Neon: Default has latest pgvector

# Or use older IVFFlat index:
CREATE INDEX idx_posts_embedding_ivfflat
ON "posts" USING ivfflat ("embedding" vector_cosine_ops)
WITH (lists = 100);
```

### Issue: "Migration timed out"

```
Error: Timeout waiting for migration to complete
```

**Cause**: Large table migration, slow database, or deadlock

**Solution**:

```bash
# Run migration with longer timeout
DATABASE_URL="postgresql://..." npx prisma migrate deploy --timeout 600

# Or manually run migration:
DATABASE_URL="postgresql://..." psql -f migration.sql

# Check locks:
SELECT * FROM pg_locks WHERE NOT granted;
```

## Best Practices

### 1. Index Maintenance

```sql
-- Reindex periodically (especially after large inserts/updates)
REINDEX INDEX idx_posts_embedding_hnsw;

-- Monitor index bloat
SELECT schemaname, tablename, indexname, pg_size_pretty(pg_relation_size(indexrelid)) as size
FROM pg_indexes
WHERE tablename = 'posts'
ORDER BY pg_relation_size(indexrelid) DESC;
```

### 2. Vacuum & Analyze

```bash
# Regular maintenance
DATABASE_URL="postgresql://..." psql -c "
  VACUUM ANALYZE posts;
"

# Or schedule via cron
0 2 * * * PGPASSWORD=... psql -U user -d dbname -c "VACUUM ANALYZE posts;"
```

### 3. Monitor Performance

```sql
-- Track slow queries
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Find slowest queries
SELECT mean_time, query
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;
```

### 4. Backup Strategy

```bash
# Backup database with embeddings
pg_dump "$DATABASE_URL" > backup.sql

# Restore
psql "$DATABASE_URL" < backup.sql

# Note: pgvector data is included in standard backup
```

## Summary

✅ **Migration creates:**

1. pgvector extension (vector data type support)
2. HNSW index on embeddings (fast similarity search)
3. Composite indexes for filtering (efficient queries)

✅ **Automatic application:**

- Runs on Docker startup before app starts
- Idempotent (safe to run multiple times)
- Handles missing/existing extensions gracefully

✅ **Verification:**

- Check extensions: `SELECT * FROM pg_extension WHERE extname = 'vector';`
- Check indexes: `\d posts` in psql
- Test performance: EXPLAIN ANALYZE on search query

✅ **Performance:**

- Query time: O(log n) with HNSW index
- For 1M posts: ~50ms per search
- Index size: ~10% of data
- Memory efficient

For deployment instructions, see [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md).
