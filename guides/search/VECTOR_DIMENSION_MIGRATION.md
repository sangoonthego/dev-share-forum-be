# Vector Dimension Migration: 1536 → 768

## Problem

```
Error: different vector dimensions 768 and 1536
```

Your database has old 1536-dimensional embeddings (OpenAI), but you're querying with 768-dimensional embeddings (Gemini). pgvector requires all vectors to have matching dimensions.

---

## Solution: Backfill All Embeddings

### Quick Start

**1. Make Admin API Call**

```bash
curl -X POST http://localhost:3000/posts/embeddings/backfill \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json"
```

**2. Monitor Progress**

```json
{
  "total": 45,
  "processed": 0,
  "failed": 0,
  "errors": []
}
```

When complete:

```json
{
  "total": 45,
  "processed": 43,
  "failed": 2,
  "errors": [
    { "postId": 5, "error": "API rate limit exceeded" },
    { "postId": 12, "error": "Connection timeout" }
  ]
}
```

---

## What Happens During Backfill

1. **Fetch All Posts** - Retrieves all posts from database
2. **Generate New Embeddings** - Creates 768-dimensional vectors using Gemini
3. **Update Database** - Replaces old 1536-dimensional vectors with new 768-dimensional ones
4. **Handle Errors** - Gracefully logs failures, continues processing

### Timeline

- **10 posts**: ~1-2 minutes
- **50 posts**: ~8-10 minutes
- **100 posts**: ~15-20 minutes
- **1000+ posts**: Consider background job

Each post takes ~6-10 seconds:

- 100-300ms: API call to Gemini
- 50-200ms: Database update
- 100ms: Rate limiting delay

---

## API Endpoint Details

**Endpoint:** `POST /posts/embeddings/backfill`

**Authentication:** Required (JWT Token)

- Must be ADMIN user
- Non-ADMIN users get 403 Forbidden

**Request:**

```bash
POST /posts/embeddings/backfill HTTP/1.1
Authorization: Bearer eyJhbGc...
Content-Type: application/json
```

**Response:** 202 Accepted

```json
{
  "total": 45, // Total posts to process
  "processed": 43, // Successfully backfilled
  "failed": 2, // Failed attempts
  "errors": [
    // Detailed error list
    {
      "postId": 5,
      "error": "API rate limit exceeded"
    },
    {
      "postId": 12,
      "error": "Connection timeout"
    }
  ]
}
```

---

## Step-by-Step: Using Postman

1. **Get Admin JWT Token**
   - Login as admin user
   - Copy JWT from response
   - Store in Postman environment variable: `{{jwt_token}}`

2. **Create Request**
   - Method: `POST`
   - URL: `{{base_url}}/posts/embeddings/backfill`
   - Headers:
     ```
     Authorization: Bearer {{jwt_token}}
     Content-Type: application/json
     ```

3. **Send Request**
   - Click "Send"
   - Wait 30 seconds-2 minutes for response
   - Monitor console logs for progress

4. **Check Results**
   - Response shows total/processed/failed counts
   - All errors listed in the errors array
   - If `failed > 0`, retry those posts manually

---

## Troubleshooting

### "Only ADMIN users can backfill embeddings"

**Solution:** Login with ADMIN account and get a fresh JWT token

### "GEMINI_API_KEY not set, using mock embedding"

**Solution:** Set environment variable

```bash
export GEMINI_API_KEY=AIzaSy...
# or in .env
GEMINI_API_KEY=AIzaSy...
```

### "different vector dimensions" still appearing

**Reason:** Backfill didn't complete all posts
**Solution:** Check the failed count in response, retry:

```bash
curl -X POST http://localhost:3000/posts/embeddings/backfill \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### API Rate Limits Hit During Backfill

**Error:** "API rate limit exceeded"
**Solution:**

- Graceful retry included
- Check the failed count in response
- Automatic 100ms delay between requests
- For 1000+ posts, use background job

### Database Timeout

**Error:** "Connection timeout"
**Solution:**

- Check database is running
- Verify PostgreSQL connection string
- Check network connectivity
- Increase connection pool if needed

---

## After Backfill: Testing Semantic Search

Once backfill completes, semantic search should work:

```bash
curl "http://localhost:3000/posts/search/semantic?query=lâm+sao+để+AI+học+dữ+liệu+riêng"
```

Expected response (200 OK):

```json
[
  {
    "id": 1,
    "title": "AI Learning Fundamentals",
    "slug": "ai-learning-fundamentals",
    "author": { "id": 1, "full_name": "John Doe" },
    "tags": [{ "id": 1, "name": "AI", "slug": "ai" }],
    "created_at": "2026-01-15T12:00:00Z"
  },
  ...
]
```

---

## Database Schema: No Changes Needed

Your Prisma schema is already correct:

```prisma
model posts {
  // ... other fields
  embedding Unsupported("vector(768)")? // ✅ 768 dimensions
}
```

The backfill only updates the data, not the schema.

---

## Advanced: Manual SQL Backfill

If you prefer to run SQL directly:

```sql
-- Update embedding dimension type (optional, already 768)
ALTER TABLE posts
ALTER COLUMN embedding TYPE vector(768);

-- Backfill (warning: requires Python/Node script to generate embeddings)
-- This is what the API endpoint does automatically
UPDATE posts
SET embedding = '[0.1, 0.2, ..., 768 values]'::vector(768)
WHERE embedding IS NOT NULL;
```

Better to use the API endpoint - it handles Gemini API calls automatically.

---

## Performance Monitoring

**During Backfill:**

```
[EMBEDDING] Starting dimension migration: 1536 → 768 (Gemini)
[EMBEDDING] Found 45 posts to backfill with new 768-dimensional embeddings
[EMBEDDING] Backfilled post 1 with 768-dim embedding
[EMBEDDING] Backfill progress: 10/45 (22%)
[EMBEDDING] Backfill progress: 20/45 (44%)
...
[EMBEDDING] Dimension migration complete. Processed: 43/45, Failed: 2
```

**Console Output Shows:**

- Progress percentage
- Individual post processing
- Error details for failed posts
- Final summary

---

## Rollback: If Needed

If something goes wrong, you can revert to old embeddings (before backfill):

```sql
-- If you have a backup, restore from it
-- Otherwise, delete new embeddings and regenerate with old model
UPDATE posts SET embedding = NULL;

-- Then rerun backfill with correct API key/model
```

Better to use version control on the database backup.

---

## FAQ

**Q: Can I run backfill multiple times?**
A: Yes, it will regenerate all embeddings. Safe to retry failed posts.

**Q: Does backfill block other requests?**
A: No, it's a background operation. API handles concurrent requests normally.

**Q: What if backfill times out?**
A: HTTP timeout? Check your client timeout setting (should be >30s). Backfill will continue in background.

**Q: How do I know backfill is done?**
A: Response shows `processed == total` (minus failures). Also check console logs.

**Q: Can I backfill only missing embeddings?**
A: Current implementation backfills ALL posts. Use `generateEmbeddingsForAllPosts()` to skip existing ones.

**Q: Is there a way to backfill in the background (async)?**
A: Currently returns 202 Accepted. Use a scheduled job for large datasets (1000+ posts).

---

## Status

✅ **Backfill Endpoint:** Added (`POST /posts/embeddings/backfill`)
✅ **Backfill Service:** Implemented (`backfillEmbeddingsForAllPosts()`)
✅ **Admin Authorization:** Protected (ADMIN only)
✅ **Error Handling:** Detailed logging
✅ **Build:** Passing (0 errors)

Ready to use! 🚀
