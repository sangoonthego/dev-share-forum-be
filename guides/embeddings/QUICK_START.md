# Embeddings Integration - Quick Start Guide

## 🚀 Quick Setup

### 1. Install Package

```bash
pnpm add openai
```

✅ **Already done** in your project.

### 2. Configure Environment Variable

**For Development (Testing without costs):**

```bash
# Skip OPENAI_API_KEY - uses mock embeddings
# Perfect for development and testing
```

**For Production (Real embeddings):**

```bash
# Set in .env or deployment platform
OPENAI_API_KEY=sk_test_...
```

### 3. Verify Setup

```typescript
// In any controller or service:
constructor(private embeddingService: EmbeddingService) {}

const status = this.embeddingService.getStatus();
console.log(status);
// { isConfigured: true/false, apiKeyPrefix?: "sk_..." }
```

## 📝 Usage Examples

### Create Post with Auto Embedding

```typescript
const post = await postsService.createPost(userId, {
  title: 'My awesome post',
  content_markdown: '# Content here...',
  tags: ['javascript', 'nestjs'],
});
// ✅ Embedding automatically generated and saved
```

### Update Post Content (Triggers Re-embedding)

```typescript
const updated = await postsService.updatePost(postId, userId, {
  title: 'Updated title',
  content_markdown: 'New content markdown',
});
// ✅ Only regenerates if title or content changed
```

### Search by Semantic Meaning

```typescript
const results = await postsService.searchPosts(
  'machine learning tutorial',
  (limit = 10),
  (offset = 0),
);
// ✅ Returns posts similar in meaning (using embeddings)
```

## 🔍 Verify Embeddings in Database

### Using Prisma Studio

```bash
npx prisma studio
# Navigate to: posts table
# Check: embedding column (should be [1536 numbers] or NULL)
```

### Using SQL

```sql
-- Check if embeddings were saved
SELECT
  id,
  title,
  (SELECT count(*) FROM posts WHERE embedding IS NOT NULL) as posts_with_embeddings
FROM posts
LIMIT 5;

-- View embedding dimensions
SELECT
  id,
  dimension(embedding) as embedding_dim
FROM posts
WHERE embedding IS NOT NULL
LIMIT 1;
```

## 💰 Cost Estimation

| Model                  | Cost    | Tokens    | Price/Post (500 words) |
| ---------------------- | ------- | --------- | ---------------------- |
| text-embedding-3-small | $0.02/M | 1536 dims | ~$0.00001              |
| text-embedding-3-large | $0.13/M | 3072 dims | ~$0.00007              |

**Example:** 10,000 posts × $0.00001 = **$0.10 total**

## ⚙️ Configuration Options

### Default Configuration

```typescript
// Model: text-embedding-3-small
// Dimensions: 1536
// Max tokens: 8,191
// Batch size: 1 (serial processing)
```

### Fallback Behavior (No API Key)

- Uses deterministic mock embeddings
- Same dimensions (1536)
- Good for development/testing
- No API costs

## 🐛 Debugging

### Check Embedding Generation

```typescript
// Test with mock
const embedding = await embeddingService.generateEmbedding('test text');
console.log(embedding.length); // 1536

// Verify L2 normalization (magnitude should be ~1)
const magnitude = Math.sqrt(embedding.reduce((sum, x) => sum + x * x, 0));
console.log(magnitude); // ~1.0
```

### Monitor in Logs

```bash
# Look for embedding-related logs
grep -i "embedding\|embedding service" logs/app.log

# Check for errors
grep -i "failed to.*embedding" logs/app.log
```

### Database Health

```sql
-- Check HNSW index health
SELECT
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'posts' AND indexname LIKE '%embedding%';
```

## ✅ Production Checklist

- [ ] `OPENAI_API_KEY` configured in production environment
- [ ] Tested with real API key locally
- [ ] Verified embeddings save to database
- [ ] HNSW index is being used for searches
- [ ] API rate limits and costs monitored
- [ ] Fallback to mock embeddings works (test by unsetting key)
- [ ] Error handling verified (missing embeddings don't crash)
- [ ] Logging configured for monitoring

## 🚨 Troubleshooting

### Issue: "Cannot find module 'openai'"

**Solution:**

```bash
pnpm add openai
pnpm install
```

### Issue: Embeddings are NULL in database

**Possible Causes:**

1. Post creation failed silently
2. Raw SQL permission issue
3. PostgreSQL pgvector extension not installed

**Check:**

```sql
-- Verify extension is installed
SELECT * FROM pg_extension WHERE extname = 'vector';

-- Verify column type
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'posts' AND column_name = 'embedding';
```

### Issue: Slow embedding generation

**Causes:**

- OpenAI API latency (normal: 100-500ms)
- Network issues
- Rate limiting (API quota)

**Optimize:**

- Use batch processing for bulk operations
- Implement async queue for non-blocking generation
- Add caching layer

### Issue: High API costs

**Solutions:**

1. Use `text-embedding-3-small` (cheapest, good quality)
2. Cache embeddings (don't regenerate unnecessarily)
3. Batch operations
4. Use mock embeddings in development

## 📚 Related Files

- Implementation Details: [EMBEDDINGS_IMPLEMENTATION.md](./EMBEDDINGS_IMPLEMENTATION.md)
- PostsService: [posts.service.ts](../../src/posts/posts.service.ts)
- EmbeddingService: [embedding.service.ts](../../src/posts/services/embedding.service.ts)
- PostsModule: [posts.module.ts](../../src/posts/posts.module.ts)

## 🔗 External Resources

- [OpenAI Embeddings API](https://platform.openai.com/docs/api-reference/embeddings)
- [pgvector Documentation](https://github.com/pgvector/pgvector)
- [HNSW Index Tuning](https://github.com/pgvector/pgvector#hnsw)

---

**Last Updated:** 2025-01-15  
**Status:** ✅ Production Ready
