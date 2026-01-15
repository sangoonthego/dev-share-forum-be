# End-to-End Embeddings Flow Visualization

## 📊 Complete Request Flow

### POST /posts (Create Post with Auto Embedding)

```
HTTP Request
  ├─ Method: POST
  ├─ URL: /api/posts
  └─ Body: {
      "title": "Machine Learning Basics",
      "content_markdown": "Embeddings capture semantic meaning...",
      "tags": ["ai", "ml"]
    }
        ↓
PostsController.createPost()
        ↓
PostsService.createPost()
  ├─ Extract title + content
  │   Text: "Machine Learning Basics. Embeddings capture semantic meaning..."
  │
  ├─→ Prisma Transaction Begin
  │   ├─ Insert post record
  │   ├─ Insert tags
  │   └─ Insert posts_tags relationships
  │
  ├─→ EmbeddingService.generateEmbedding(text)
  │   ├─ Check: Is OPENAI_API_KEY set?
  │   │
  │   ├─ YES → Call OpenAI API
  │   │   ├─ Model: text-embedding-3-small
  │   │   ├─ Input: "Machine Learning Basics. Embeddings..."
  │   │   └─ Output: [0.0234, -0.0156, ..., 0.0891] (1536 dims)
  │   │
  │   └─ NO → Generate Mock Embedding
  │       └─ Output: [deterministic vector] (1536 dims)
  │
  ├─→ Save Embedding (Raw SQL)
  │   UPDATE posts SET embedding = $1::vector(1536)
  │   WHERE id = $2
  │   Parameters: [[...1536 values], postId]
  │
  ├─ Redis: Invalidate list caches
  │
  └─→ Return PostResponseDto
        {
          "id": 1,
          "title": "Machine Learning Basics",
          "slug": "machine-learning-basics",
          "embedding_status": "generated" | "mock" | "failed"
        }
        ↓
    HTTP Response 201 Created
```

---

### PATCH /posts/:id (Update Post with Re-embedding)

```
HTTP Request
  ├─ Method: PATCH
  ├─ URL: /api/posts/1
  └─ Body: {
      "title": "Updated ML Title",
      "content_markdown": "Updated content..."
    }
        ↓
PostsController.updatePost()
        ↓
PostsService.updatePost()
  ├─ Fetch existing post from DB
  │
  ├─ Detect Changes
  │   ├─ Title changed? ✓
  │   └─ Content changed? ✓
  │   → Trigger re-embedding
  │
  ├─→ Prepare Update Data
  │   ├─ title: "Updated ML Title"
  │   ├─ slug: "updated-ml-title" (regenerated)
  │   └─ content_markdown: sanitized version
  │
  ├─→ Generate New Embedding
  │   Text: "Updated ML Title. Updated content..."
  │   ↓
  │   EmbeddingService.generateEmbedding()
  │   ↓
  │   Result: [new 1536-dim vector]
  │
  ├─→ Prisma Transaction
  │   ├─ Update post fields
  │   ├─ Remove old tags
  │   └─ Insert new tags
  │
  ├─→ Save New Embedding (Raw SQL)
  │   UPDATE posts SET embedding = $1::vector(1536)
  │   WHERE id = $2
  │
  ├─ Redis: Invalidate all caches
  │   ├─ Cache by slug (old and new)
  │   └─ All list caches
  │
  ├─ Log Activity: POST_UPDATED
  │
  └─→ Return Updated PostResponseDto
        ↓
    HTTP Response 200 OK
```

---

### GET /posts/search?q=machine+learning (Semantic Search)

````
HTTP Request
  ├─ Method: GET
  ├─ URL: /api/posts/search
  └─ Query: { q: "machine learning", limit: 10, offset: 0 }
        ↓
PostsController.searchPosts()
        ↓
PostsService.searchPosts()
  ├─ Check Redis Cache
  │   Key: posts:search:query_hash:limit:10:offset:0
  │   ├─ CACHE HIT? → Return cached results
  │   └─ CACHE MISS? → Continue
  │
  ├─→ Generate Query Embedding
  │   Text: "machine learning"
  │   ↓
  │   EmbeddingService.generateEmbedding()
  │   ↓
  │   Result: [1536-dim vector for "machine learning"]
  │
  ├─→ Execute Similarity Search (Raw SQL)
  │   SQL Query:
  │   ```
  │   SELECT
  │     id, title, content_markdown, slug,
  │     1 - (embedding <=> $1::vector(1536)) as similarity
  │   FROM posts
  │   WHERE is_published = true
  │     AND deleted_at IS NULL
  │     AND embedding IS NOT NULL
  │   ORDER BY embedding <=> $1::vector(1536)
  │   LIMIT $2 OFFSET $3
  │   ```
  │   Parameters: [queryEmbedding, 10, 0]
  │
  │   HNSW Index Used?
  │   ├─ Index: idx_posts_embedding_hnsw
  │   ├─ Method: Hierarchical Navigable Small World
  │   ├─ Time: ~1-10ms for typical dataset
  │   └─ Memory: O(n) with small constant factor
  │
  ├─→ Calculate Similarity Scores
  │   Cosine Distance: 1 - (a <=> b)
  │   Results:
  │   ├─ Post 1: similarity = 0.92 ✓ High match
  │   ├─ Post 2: similarity = 0.78 ✓ Medium match
  │   └─ Post 3: similarity = 0.45 ✗ Low match
  │
  ├─ Cache Results
  │   Key: posts:search:query_hash:limit:10:offset:0
  │   TTL: 1 hour
  │   Value: [post1, post2, post3, ...]
  │
  └─→ Return Results
        [
          {
            "id": 1,
            "title": "Machine Learning Basics",
            "similarity": 0.92
          },
          {
            "id": 2,
            "title": "Deep Learning Tutorial",
            "similarity": 0.78
          }
        ]
        ↓
    HTTP Response 200 OK with Results
````

---

## 🗄️ Database State Diagram

### Before (Initial State)

```
posts table
┌─────┬──────────────┬────────────────────┬───────────┐
│ id  │ title        │ embedding          │ created   │
├─────┼──────────────┼────────────────────┼───────────┤
│ 1   │ "Post 1"     │ NULL               │ 2025-01-14│
│ 2   │ "Post 2"     │ NULL               │ 2025-01-14│
└─────┴──────────────┴────────────────────┴───────────┘
```

### After Create/Update (With Embeddings)

```
posts table
┌─────┬──────────────┬──────────────────────────────────┬───────────┐
│ id  │ title        │ embedding                        │ created   │
├─────┼──────────────┼──────────────────────────────────┼───────────┤
│ 1   │ "Post 1"     │ [0.0234, -0.0156, ..., 0.0891]  │ 2025-01-14│
│ 2   │ "Post 2"     │ [0.0123, 0.0456, ..., -0.0234]  │ 2025-01-14│
└─────┴──────────────┴──────────────────────────────────┴───────────┘

HNSW Index (automatically created)
posts_embedding_hnsw
└─ 1536-dimensional vector space
   ├─ Node: Post 1 embedding
   │  └─ Links to nearest neighbors
   └─ Node: Post 2 embedding
      └─ Links to nearest neighbors
```

---

## 🔄 Embedding Lifecycle

```
1. CREATION
   ├─ User creates post
   ├─ EmbeddingService generates vector
   ├─ Vector saved to DB via Raw SQL
   ├─ HNSW index updated automatically
   └─ State: READY_FOR_SEARCH

2. UPDATES
   ├─ User updates post title/content
   ├─ System detects change
   ├─ EmbeddingService regenerates vector
   ├─ Vector updated in DB via Raw SQL
   ├─ HNSW index rebalances
   └─ State: READY_FOR_SEARCH (refreshed)

3. SEARCHES
   ├─ User searches with query
   ├─ Query text → embedding
   ├─ Embedding → similarity search
   ├─ HNSW index traversed (O(log n))
   ├─ Results returned with scores
   └─ State: SEARCH_COMPLETE

4. OPTIMIZATION
   ├─ Results cached (Redis, 1 hour)
   ├─ Repeated searches use cache
   ├─ Cache invalidated on post changes
   └─ State: CACHE_WARM
```

---

## 📈 Performance Profile

### Embedding Generation

```
Mock Mode (No API):     ~1ms
API Mode (OpenAI):      100-500ms (network dependent)
Batch (10 posts):       1-5 seconds (serial)

Total for Create:
├─ Prisma transaction:  ~10ms
├─ Embedding:           100-500ms
├─ Raw SQL save:        ~5ms
└─ Total:               ~115-515ms
```

### Search Performance

```
First Search:           ~100-600ms
  ├─ Query embedding:   100-500ms
  ├─ HNSW search:       1-10ms
  └─ Response:          ~10ms

Subsequent Searches:    ~5-20ms (from cache)

Database (1000 posts):
  ├─ HNSW index size:   ~6MB
  ├─ Query time:        ~5ms
  └─ Memory overhead:   Minimal
```

---

## 🛡️ Error Handling Flow

```
EmbeddingService.generateEmbedding()
  ├─ Try: Call OpenAI API
  │   ├─ Success → Return embedding
  │   └─ Error? (Network, Rate limit, Auth)
  │       ├─ Log error
  │       └─ Fallback to Mock
  │
  └─ Return: Mock or Real embedding

PostsService.createPost()
  ├─ Try: Generate embedding
  │   ├─ Success → Save with raw SQL
  │   └─ Error? (API down, etc.)
  │       ├─ Log warning
  │       └─ Continue (POST CREATED WITHOUT EMBEDDING)
  │
  └─ Return: Post with or without embedding
     (Post always created, embedding best-effort)
```

---

## 🔍 Data Flow Summary

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │ HTTP
       ↓
┌──────────────────┐
│ PostsController  │
└──────┬───────────┘
       │
       ↓
┌──────────────────────┐
│ PostsService         │
├──────────────────────┤
│ createPost()         │
│ updatePost()         │
│ searchPosts()        │
└──┬───────────┬───────┘
   │           │
   ↓           ↓
┌─────────────────────┐    ┌──────────────────────┐
│ EmbeddingService    │    │ PrismaService        │
├─────────────────────┤    ├──────────────────────┤
│ generateEmbedding() │    │ Transaction mgmt     │
│ OpenAI API calls    │    │ Raw SQL execution    │
└────────┬────────────┘    └────────┬─────────────┘
         │                          │
         ↓                          ↓
    ┌─────────┐          ┌──────────────────┐
    │ OpenAI  │          │ PostgreSQL       │
    │ API     │          │ + pgvector       │
    │         │          │ + HNSW index     │
    └─────────┘          └──────────────────┘
         ↑                          ↑
         │                          │
    Embeddings              Posts + Vectors
```

---

**Last Updated:** 2025-01-15  
**Diagram Version:** 1.0
