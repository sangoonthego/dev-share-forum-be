# Vector Dimension Fix: Quick Reference

## The Error

```
different vector dimensions 768 and 1536
```

## Root Cause

Database has 1536-dim embeddings (OpenAI) but queries use 768-dim (Gemini). pgvector requires matching dimensions.

## The Fix

**One API call:**

```bash
curl -X POST http://localhost:3000/posts/embeddings/backfill \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## What It Does

- Fetches all posts
- Generates new 768-dimensional embeddings (Gemini)
- Updates database with new vectors
- Reports progress and errors

## Timeline

- 10 posts: 1-2 min
- 50 posts: 8-10 min
- 100 posts: 15-20 min

## Response

```json
{
  "total": 45,
  "processed": 43,
  "failed": 2,
  "errors": [{ "postId": 5, "error": "Rate limit" }]
}
```

## Requirements

✅ Admin user (required)
✅ JWT token (required)
✅ GEMINI_API_KEY set (required)
✅ Network connection (required)

## After Backfill

Semantic search works normally:

```bash
curl "http://localhost:3000/posts/search/semantic?query=AI+learning"
```

Returns list of most relevant posts with 768-dimensional similarity ranking.

---

**Status:** ✅ Ready to use  
**Endpoint:** `POST /posts/embeddings/backfill`  
**Auth:** Admin only  
**Duration:** 6-10 sec per post
