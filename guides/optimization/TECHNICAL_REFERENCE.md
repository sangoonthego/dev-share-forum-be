# 🔬 TECHNICAL REFERENCE - Architecture & Implementation Details

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    API Controllers                          │
├─────────────────────────────────────────────────────────────┤
│                   LoggingInterceptor                        │
│              (All HTTP requests/responses)                  │
├─────────────────────────────────────────────────────────────┤
│  PostsService  │  AuthService  │  CommentsService │ ...   │
├────────┬────────────────────┬─────────────────┬────────────┤
│        │                    │                 │            │
│   QueueService         LoggerService      RedisService    │
│   ├─ email queue      ├─ Winston          ├─ cache-aside │
│   ├─ embedding queue  ├─ Sentry           ├─ stampede    │
│   └─ viewCount queue  └─ Masking          └─ tags        │
│        │                    │                 │            │
├────────┴────────────────────┴─────────────────┴────────────┤
│                   BullMQ Processors                        │
│  ├─ EmailProcessor      ├─ EmbeddingProcessor             │
│  └─ ViewCountProcessor                                    │
├─────────────────────────────────────────────────────────────┤
│  Redis  │  PostgreSQL (with pgvector)  │  External APIs   │
└─────────────────────────────────────────────────────────────┘
```

---

## 1. Queue System Architecture

### BullMQ Queue Configuration

```typescript
// 3 Separate Queues with different priorities

Queue: 'email'
├─ Default Options:
│  ├─ attempts: 3
│  ├─ backoff: exponential (2s, 4s, 8s)
│  └─ removeOnComplete: true
├─ Jobs:
│  ├─ User notifications
│  ├─ Password reset
│  └─ Email verification
└─ Processing Model: Sequential + High Priority

Queue: 'embedding'
├─ Default Options:
│  ├─ attempts: 2
│  ├─ backoff: exponential
│  └─ removeOnComplete: true
├─ Jobs:
│  ├─ Vector generation
│  ├─ Post creation embeddings
│  └─ Post update embeddings
└─ Processing Model: Parallel (multiple workers)

Queue: 'viewCount'
├─ Default Options:
│  ├─ attempts: 1
│  ├─ removeOnComplete: true
│  └─ removeOnFail: true (non-critical)
├─ Jobs:
│  └─ Post view count increments
└─ Processing Model: Batch (can aggregate)
```

### Retry Strategy

```typescript
// Exponential backoff formula
delay = baseDelay * (2 ^ attemptNumber)

Email Queue (3 attempts):
├─ Attempt 1 fails → Wait 2s → Retry
├─ Attempt 2 fails → Wait 4s → Retry
├─ Attempt 3 fails → Dead Letter Queue (manual intervention needed)
└─ Typical success rate: >98% with this strategy

Embedding Queue (2 attempts):
├─ Attempt 1 fails → Wait 2s → Retry
├─ Attempt 2 fails → DLQ (can regenerate later)
└─ Typical success rate: >99%

ViewCount Queue (1 attempt):
└─ Fails silently (non-critical)
```

---

## 2. Token Rotation Architecture

### Token Structure & Lifecycle

```
Initial Login
├─ Generate:
│  ├─ family = UUID v4 (unique chain identifier)
│  ├─ AT = JWT { sub, email, role, jti }
│  └─ RT = JWT { sub, email, role, family }
├─ Store:
│  ├─ Redis key: rt:{userId}:{family} = hash(RT)
│  ├─ Redis key: rt_family:{userId} = family (current pointer)
│  └─ Cookie: refresh_token = RT (httpOnly, secure, sameSite=strict)
└─ Validity: AT=15min, RT=7days

First Refresh (valid RT)
├─ Verify:
│  ├─ RT hash matches stored hash ✓
│  ├─ Family in RT matches rt_family:{userId} ✓
│  └─ Token not from old family ✓
├─ Rotate:
│  ├─ Generate new family = UUID v4
│  ├─ Invalidate old: DEL rt:{userId}:{oldFamily}
│  ├─ Store new: rt:{userId}:{newFamily} = hash(newRT)
│  ├─ Update pointer: rt_family:{userId} = newFamily
│  └─ Return: new AT + new RT with new family
└─ Efficiency: One-to-one rotation (not one-to-many)

Subsequent Refresh (old RT reused - BREACH!)
├─ Detect:
│  ├─ RT family in token ≠ rt_family:{userId}
│  └─ This indicates token from PREVIOUS family used again
├─ Response:
│  ├─ Log security event
│  ├─ Revoke ALL tokens: DEL rt:{userId}:*
│  ├─ Clear pointer: DEL rt_family:{userId}
│  └─ Force re-authentication
└─ Impact: Attack surface limited (must catch quickly)
```

### Security Properties

```
Attack Vector 1: Stolen RT (from device)
├─ Old Device: Attempts refresh with old RT
├─ New Device: Has old RT (was intercepted)
└─ Result: DETECTED! New device tries old RT → Family mismatch → REVOKE

Attack Vector 2: Database breach (hashes exposed)
├─ Attacker: Has hash(RT) from Redis
├─ Attempts: Cannot use hash directly (needs plain RT)
├─ Result: Plain RT unknown → Cannot refresh

Attack Vector 3: JWT token interception
├─ Attacker: Intercepts AT (short-lived, 15min)
├─ Impact: Limited API access for 15 minutes
├─ Mitigation: AT expires quickly, RT rotation prevents renewal
└─ Result: Limited window of vulnerability

Protection: Token Family Chain
├─ Each refresh creates new family
├─ Old families never valid again
├─ Reuse of any old family = breach signal
└─ Automatic revocation prevents further abuse
```

---

## 3. Vector Search Optimization

### HNSW Index Details

```sql
-- Index Structure
CREATE INDEX idx_posts_embedding_hnsw
  ON posts USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 200);

Parameters:
├─ m = 16
│  ├─ Maximum connections per node
│  ├─ Balance: 16 = good search quality + reasonable build time
│  └─ Tuning: Lower (8) = faster build, worse search; Higher (32) = slower build, better search
│
├─ ef_construction = 200
│  ├─ Width during index building
│  ├─ Higher = more accurate, slower to build
│  ├─ Typical: 100-500
│  └─ Can be changed in config without rebuilding
│
└─ vector_cosine_ops
   ├─ Operator: <=> (cosine distance)
   ├─ Distance range: 0 (identical) to 2 (opposite)
   └─ Alternatives: L2 distance, IP (inner product)
```

### Query Performance Timeline

```
Database Size    Without Index   With HNSW Index   Speedup
─────────────────────────────────────────────────────────
100 posts        1ms             <1ms              1x
1,000 posts      50ms            1ms               50x
10,000 posts     500ms           5ms               100x
100,000 posts    5,000ms         50ms              100x
1,000,000 posts  50,000ms        500ms             100x

Scaling: O(n) → O(log n)
```

### Similarity Threshold Impact

```typescript
// Distance values for typical queries
Query: "JavaScript async programming"

Post A: "Learn async await in JavaScript" → distance = 0.15 (very relevant)
Post B: "JavaScript tutorial" → distance = 0.45 (relevant)
Post C: "Web development basics" → distance = 0.8 (somewhat relevant)
Post D: "Python programming" → distance = 1.5 (not relevant)

Threshold Settings:
├─ threshold = 0.5 (strict)
│  └─ Returns: Posts A, B (only highly relevant)
│
├─ threshold = 1.0 (balanced, DEFAULT)
│  └─ Returns: Posts A, B, C (mostly relevant)
│
└─ threshold = 1.5 (loose)
   └─ Returns: Posts A, B, C, D (includes less relevant)

Recommendation: Default 1.0, adjust based on UX feedback
```

---

## 4. Cache Stampede Prevention

### Problem: Cache Stampede

```
Without Protection:
1:00:00 – Cache expires on "popular-posts"
         N simultaneous requests hit Redis
         MISS! All N requests query database
         Database gets N queries at once (thundering herd)
         Server load spikes 1000%
         Response time: 500ms+ (degraded UX)

With Stampede Protection:
1:00:00 – Cache expires
         Request 1: Cache miss, acquires lock
         Requests 2-N: Cache miss, wait for lock (100ms timeout)
         Request 1: Computes value, stores in cache
         Requests 2-N: Read from cache (just cached!)
         Database gets 1 query instead of N
         Response time: 2ms (cached result)
         Efficiency: N-to-1 reduction
```

### Implementation Details

```typescript
// Probabilistic Early Expiration (PEE)
TTL = 1 hour (3600 seconds)
xfetch = 0.1 (recompute in last 10%)

Time Distribution:
├─ 0-54min (0-3240s): Return cached value (probability 0%)
├─ 54-60min (3240-3600s): Recompute with increasing probability
│  ├─ At 54min: 0% chance to recompute
│  ├─ At 57min: 50% chance to recompute
│  └─ At 60min: 100% chance to recompute (forced refresh)
└─ Benefit: Gradual background refresh prevents sudden expiry

// Distributed Lock
Lock Key: lock:{cacheKey}
Lock Value: timestamp (for cleanup)
Lock TTL: 10 seconds (max compute time)

Behavior:
├─ Process 1: SET lock:key timestamp NX EX 10
│  └─ Acquires lock, computes value, stores cache, releases lock
├─ Process 2-N: SET lock:key timestamp NX EX 10
│  └─ Lock already exists, waits up to 100ms, retries
└─ Auto-cleanup: Lock expires in 10s if process crashes
```

---

## 5. Tagged Key System

### Tagging Strategy

```
Old Pattern (DEPRECATED):
├─ Query: redis.scan(0, 'MATCH', 'post:*')
├─ Problems:
│  ├─ O(n) complexity (scans all keys)
│  ├─ Blocking operation (holds Redis connection)
│  ├─ Unpredictable latency
│  └─ Fails in Redis cluster mode
└─ Typical cost: 50-500ms per operation

New Tagged System (RECOMMENDED):
├─ Query: redis.invalidateByTag('posts')
├─ Benefits:
│  ├─ O(1) complexity (set deletion)
│  ├─ Non-blocking (instant return)
│  ├─ Predictable <1ms latency
│  └─ Works in cluster mode
└─ Typical cost: <1ms per operation
```

### Tag Hierarchy Example

```
Posts Domain:
├─ Tag: "posts" (all posts)
│  └─ Keys: post:123, post:456, post:789, post:list:1:10
├─ Tag: "post:123" (specific post)
│  └─ Keys: post:123, post:123:comments, author:123:posts
├─ Tag: "author:456" (author's posts)
│  └─ Keys: post:123, post:456, post:list:author:456
└─ Tag: "feed:user:789" (user's feed)
   └─ Keys: feed:789, feed:789:page:1, feed:789:page:2

Invalidation Example:
├─ Post updated: invalidateByTag("post:123")
│  └─ Removes: post:123, post:123:comments (specific post)
├─ Author deleted: invalidateByTag("author:456")
│  └─ Removes: all author's posts
├─ System event: invalidateByTag("posts")
│  └─ Removes: ALL post-related cache
└─ User logout: invalidateByTag("user:789")
   └─ Removes: user's personalized data
```

---

## 6. Logging Architecture

### Sensitive Data Masking

```typescript
Redacted Fields:
├─ password → "***REDACTED***"
├─ passwordHash → "***REDACTED***"
├─ token → "***REDACTED***"
├─ accessToken → "***REDACTED***"
├─ refreshToken → "***REDACTED***"
├─ apiKey → "***REDACTED***"
├─ secretKey → "***REDACTED***"
├─ email → "***REDACTED***" (optional, from user perspective)
├─ creditCard → "***REDACTED***"
├─ cvv → "***REDACTED***"
├─ ssn → "***REDACTED***"
├─ authorization → "***REDACTED***" (HTTP header)
└─ cookie → "***REDACTED***" (HTTP header)

Example:
Input Log:
{
  "user": {
    "email": "user@example.com",
    "password": "secret123",
    "tokens": { "accessToken": "eyJhb..." }
  }
}

Output Log:
{
  "user": {
    "email": "***REDACTED***",
    "password": "***REDACTED***",
    "tokens": { "accessToken": "***REDACTED***" }
  }
}
```

### Log Levels & Usage

```
ERROR (log.error)
├─ Database failures
├─ API timeouts
├─ Unexpected exceptions
└─ Sent to: Console, Error File, Sentry

WARN (log.warn)
├─ Failed login attempts
├─ Slow queries (>1s)
├─ Retry exhausted (entering DLQ)
└─ Sent to: Console, Combined File

INFO (log.log)
├─ Application events
├─ Job completions
├─ Cache operations
└─ Sent to: Combined File

DEBUG (log.debug)
├─ Detailed operation steps
├─ Variable values
├─ Cache hits/misses
└─ Sent to: Combined File (development only)

SECURITY (log.logSecurityEvent)
├─ Login attempts
├─ Token operations
├─ Permission denials
├─ Breach detection
└─ Sent to: Console, Security Audit Log, Sentry
```

### Performance Metrics Logging

```typescript
Usage:
logger.logPerformance(operation, duration, context, success);

Example:
logger.logPerformance('getPostBySlug', 5, 'POSTS', true);
logger.logPerformance('generateEmbedding', 2500, 'QUEUE', false);

Output:
[PERFORMANCE] getPostBySlug: 5ms ✓
[PERFORMANCE] generateEmbedding: 2500ms ✗

Used for:
├─ Performance monitoring
├─ Identifying slow operations
├─ Capacity planning
└─ SLA tracking
```

---

## 7. Database Index Strategy

### Index Types & Coverage

```
Composite Indices (Multi-column):
├─ idx_posts_status_created_at
│  └─ WHERE status = 'PUBLISHED' ORDER BY created_at DESC
│     Used: Feed queries, public listings
│
├─ idx_posts_author_created_at
│  └─ WHERE author_id = X ORDER BY created_at DESC
│     Used: User profile posts
│
├─ idx_comments_post_created_at
│  └─ WHERE post_id = X ORDER BY created_at DESC
│     Used: Post comment threads
│
└─ idx_notifications_user_read
   └─ WHERE user_id = X AND is_read = false ORDER BY created_at DESC
      Used: Unread notification count

Partial Indices (Filtered):
├─ idx_posts_deleted_at WHERE deleted_at IS NOT NULL
│  └─ Only indexes soft-deleted posts (rare case)
│
└─ idx_comments_deleted_at WHERE deleted_at IS NOT NULL
   └─ Only indexes soft-deleted comments

Index Statistics:
├─ Before: ~500ms for paginated queries
├─ After: ~2-5ms for paginated queries
├─ Speedup: 100-250x improvement
└─ Storage cost: +5-10% of table size
```

### Query Plan Verification

```sql
-- Verify index is being used:
EXPLAIN ANALYZE
SELECT * FROM posts
WHERE status = 'PUBLISHED'
ORDER BY created_at DESC
LIMIT 10;

-- Should show: "Index Scan using idx_posts_status_created_at"
-- Not: "Seq Scan" or "Index Scan Backward"

-- Check index size:
SELECT
  indexname,
  pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_indexes
WHERE tablename = 'posts'
ORDER BY size DESC;
```

---

## 8. Environment Configuration

```env
# Logging
LOG_LEVEL=info                          # error, warn, info, debug
LOG_FORMAT=json                         # For ELK stack compatibility

# Sentry (Error Tracking)
SENTRY_DSN=https://key@org.sentry.io/   # Optional
SENTRY_TRACE_RATE=0.1                   # 10% sample rate

# Redis (Bull + Cache)
REDIS_HOST=localhost                    # Redis server
REDIS_PORT=6379                         # Redis port
REDIS_DB=0                              # Database number
REDIS_PASSWORD=optional                 # Auth password

# Bull Queues
BULL_QUEUE_PREFIX=devshare:            # Key prefix
BULL_PROCESSING_INTERVAL=1000          # Check interval (ms)

# JWT Tokens
JWT_AT_SECRET=your-secret-key          # Access token secret
JWT_RT_SECRET=your-rt-secret           # Refresh token secret

# Database (Prisma)
DATABASE_URL=postgresql://user:pass@localhost/db

# Node
NODE_ENV=production|development         # Environment
```

---

## Summary: Architecture Layers

```
Layer 1: API Controllers
         ↓ (all requests through interceptor)

Layer 2: Logging Interceptor
         ↓ (logs + masks + measures latency)

Layer 3: Service Layer
         ├─ PostsService → QueueService (async jobs)
         ├─ AuthService → TokenService (token rotation)
         └─ CommentsService → RedisService (caching)

Layer 4: Infrastructure
         ├─ Bull/Redis Queue Workers
         ├─ Winston Logger → Files + Sentry
         └─ Redis Cache → PostgreSQL DB

Layer 5: Data Storage
         ├─ PostgreSQL (relational data + pgvector)
         └─ Redis (cache + job queue + session store)

Layer 6: External Services
         ├─ Sentry (error tracking)
         ├─ Email Provider (SendGrid, Mailgun)
         ├─ Embedding API (OpenAI, Gemini)
         └─ Cloud Storage (Cloudinary)
```

This architecture ensures:
✅ Scalability (async processing)
✅ Security (token rotation, breach detection)
✅ Performance (cache stampede prevention, vector indices)
✅ Observability (comprehensive logging)
✅ Reliability (retry logic, error tracking)

---

**Reference Complete** ✅
