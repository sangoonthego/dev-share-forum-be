# Quick Start: Vector Dimension Migration (Copy & Paste)

## Prerequisites

1. **Application running:**

   ```bash
   cd d:\saves\Fullstack\Project\dev-share-lite-be
   pnpm start:dev
   ```

2. **Admin JWT token** (get from login response)

3. **GEMINI_API_KEY set** (should already be set from before)

---

## Commands to Run

### 1. Login as Admin (Get JWT Token)

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "admin_password"
  }'
```

**Response:**

```json
{
  "access_token": "eyJhbGc...",
  "refresh_token": "eyJhbGc...",
  "user": { "id": 1, "email": "admin@example.com", "role": "ADMIN" }
}
```

**Copy the `access_token` value (you'll use it next)**

---

### 2. Run Backfill (Replace TOKEN)

```bash
# Using the token from above
curl -X POST http://localhost:3000/posts/embeddings/backfill \
  -H "Authorization: Bearer eyJhbGc..." \
  -H "Content-Type: application/json"
```

**Alternative (if using curl from PowerShell):**

```powershell
$token = "eyJhbGc..."
$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type" = "application/json"
}

Invoke-WebRequest -Uri "http://localhost:3000/posts/embeddings/backfill" `
  -Method POST `
  -Headers $headers
```

**Immediate Response (202 Accepted):**

```json
{
  "total": 45,
  "processed": 0,
  "failed": 0,
  "errors": []
}
```

**Wait 30 seconds to 5 minutes depending on post count...**

**Final Response (after backfill completes):**

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

### 3. Monitor Progress (Optional)

Watch the server console in the terminal where you ran `pnpm start:dev`:

```
[EMBEDDING] Starting dimension migration: 1536 → 768 (Gemini)
[EMBEDDING] Found 45 posts to backfill with new 768-dimensional embeddings
[EMBEDDING] Backfilled post 1 with 768-dim embedding
[EMBEDDING] Backfilled post 2 with 768-dim embedding
...
[EMBEDDING] Backfill progress: 10/45 (22%)
...
[EMBEDDING] Backfill progress: 20/45 (44%)
...
[EMBEDDING] Dimension migration complete. Processed: 43/45, Failed: 2
```

---

### 4. Test Semantic Search (Verify It Works)

```bash
curl "http://localhost:3000/posts/search/semantic?query=lâm%20sao%20để%20AI%20học%20dữ%20liệu%20riêng&limit=5"
```

**Expected Response (200 OK):**

```json
[
  {
    "id": 1,
    "title": "Advanced AI Learning",
    "slug": "advanced-ai-learning",
    "content_markdown": "...",
    "is_published": true,
    "status": "PUBLISHED",
    "view_count": 42,
    "author_id": 1,
    "author": {
      "id": 1,
      "email": "user@example.com",
      "full_name": "John Doe"
    },
    "tags": [
      { "id": 1, "name": "AI", "slug": "ai" },
      { "id": 2, "name": "Learning", "slug": "learning" }
    ],
    "created_at": "2026-01-15T12:00:00Z",
    "updated_at": "2026-01-15T12:00:00Z"
  },
  ...
]
```

**If still getting dimension error:**

- Check backfill response for failed count
- Some posts may need retry
- Re-run backfill command again

---

## If You Have Failed Posts

### Check Which Posts Failed

From the backfill response, you got a list of failed posts. Example:

```json
"errors": [
  { "postId": 5, "error": "API rate limit exceeded" },
  { "postId": 12, "error": "Connection timeout" }
]
```

### Retry Backfill

Simply run the backfill command again - it will regenerate embeddings for failed posts:

```bash
curl -X POST http://localhost:3000/posts/embeddings/backfill \
  -H "Authorization: Bearer eyJhbGc..." \
  -H "Content-Type: application/json"
```

---

## Troubleshooting

### Error: "Only ADMIN users can backfill embeddings"

**Solution:** Make sure you're using a JWT token from an ADMIN user login

### Error: "Cannot read property 'backfill'" or 404

**Solution:** Make sure app is built and restarted

```bash
pnpm build
pnpm start:dev
```

### Error: "GEMINI_API_KEY not set, using mock embedding"

**Solution:** The backfill will still work but use mock embeddings. To use real Gemini:

```bash
# Set environment variable
$env:GEMINI_API_KEY = "AIzaSy..."

# Or in .env file
GEMINI_API_KEY=AIzaSy...

# Then restart app
pnpm start:dev
```

### Error: "different vector dimensions" still appears after backfill

**Solution:** Some posts failed. Check the errors array and retry:

```bash
curl -X POST http://localhost:3000/posts/embeddings/backfill \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json"
```

### Error: 401 Unauthorized

**Solution:** JWT token is invalid. Login again to get a new token:

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"password"}'
```

### Error: Connection timeout during backfill

**Solution:** Database may be slow. Backfill is already retrying. Just wait and check progress in console.

---

## Quick Command Summary

```bash
# 1. Login (get token)
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"admin_password"}'

# 2. Backfill (replace TOKEN)
curl -X POST http://localhost:3000/posts/embeddings/backfill \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json"

# 3. Test search
curl "http://localhost:3000/posts/search/semantic?query=AI+learning"

# 4. Check if any failed (re-run step 2 if needed)
```

---

## Expected Timeline

- **5-10 posts:** 1-2 minutes
- **10-20 posts:** 2-5 minutes
- **50 posts:** ~8-10 minutes
- **100 posts:** ~15-20 minutes

If it takes longer, check console for errors.

---

## Success Checklist

After backfill completes:

- ✅ Response shows `processed > 0`
- ✅ Console shows "Dimension migration complete"
- ✅ Search endpoint works (200 OK, not 500)
- ✅ Search returns posts with distance/similarity scores
- ✅ No more "different vector dimensions" errors

**All done!** 🎉

---

## What Happens Next

### Before Backfill

- ❌ Semantic search returns 500 error
- ❌ Database has 1536-dim vectors
- ❌ Queries have 768-dim vectors
- ❌ Dimension mismatch

### After Backfill

- ✅ Semantic search works perfectly
- ✅ Database has 768-dim vectors
- ✅ Queries have 768-dim vectors
- ✅ All dimensions match (pgvector happy)

---

## Help

If commands fail:

1. Check app is running: `pnpm start:dev` in another terminal
2. Verify JWT token is fresh (login again if needed)
3. Check database connection
4. Review console logs for detailed errors

All documentation:

- `VECTOR_DIMENSION_MIGRATION.md` - Complete guide
- `VISUAL_GUIDE_DIMENSION_MIGRATION.md` - Diagrams
- `VECTOR_DIMENSION_COMPLETE_SOLUTION.md` - Technical details
