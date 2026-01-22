# Gemini AI System - Setup & Getting Started

## 1️⃣ Prerequisites Check

```bash
# Verify all dependencies installed
npm list @google/generative-ai
npm list bull
npm list socket.io
npm list redis
npm list ioredis

# Check PostgreSQL pgvector extension
psql -c "CREATE EXTENSION IF NOT EXISTS vector;"

# Verify Redis is running
redis-cli ping
# Expected: PONG
```

## 2️⃣ Environment Configuration

Update your `.env` file:

```bash
# Add Gemini API Key (required)
GEMINI_API_KEY=your_gemini_api_key_here

# Verify existing variables are set
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
DATABASE_URL=postgresql://postgres:password@localhost:5432/devshare_forum_db
SENTRY_DSN=https://...
JWT_AT_SECRET=...
JWT_RT_SECRET=...
```

## 3️⃣ Start the Application

```bash
# Development mode
npm run start:dev

# Production mode
npm run build
npm run start:prod
```

**Expected logs**:

```
[Nest] 12345 - 01/20/2026, 10:30:00 AM   LOG [NestFactory] Starting Nest application...
[Nest] 12345 - 01/20/2026, 10:30:02 AM   LOG [InstanceLoader] AiModule dependencies initialized
[Nest] 12345 - 01/20/2026, 10:30:02 AM   LOG [InstanceLoader] QueueModule dependencies initialized
[Nest] 12345 - 01/20/2026, 10:30:02 AM   LOG [RoutesResolver] AiController {/ai}:
[Nest] 12345 - 01/20/2026, 10:30:02 AM   LOG [WebSocketGateway] AI Chat Gateway initialized
```

## 4️⃣ Test REST API Endpoint

### Get JWT Token

```bash
# Login to get JWT token
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "your@email.com",
    "password": "your_password"
  }'

# Save the accessToken from response
export JWT_TOKEN="eyJhbGc..."
```

### Ask AI Question

```bash
# Single message (creates new session)
curl -X POST http://localhost:3000/ai/chat \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "How do I implement pagination in NestJS?"
  }'

# Response with session:
{
  "message": "To implement pagination in NestJS...",
  "sources": [
    {
      "title": "Pagination Guide",
      "slug": "pagination-guide",
      "relevanceScore": 0.89
    }
  ],
  "sessionId": "session_1705747800000_abc123"
}
```

### Continue Conversation

```bash
# Use sessionId to continue conversation
curl -X POST http://localhost:3000/ai/chat \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "What about cursor-based pagination?",
    "sessionId": "session_1705747800000_abc123"
  }'
```

### Retrieve Session History

```bash
curl -X GET http://localhost:3000/ai/chat/session_1705747800000_abc123 \
  -H "Authorization: Bearer $JWT_TOKEN"

# Response:
{
  "sessionId": "session_1705747800000_abc123",
  "createdAt": "2026-01-20T10:30:00Z",
  "lastUpdatedAt": "2026-01-20T10:35:00Z",
  "history": [
    {
      "role": "user",
      "content": "How do I implement pagination?",
      "timestamp": 1705747800000
    },
    {
      "role": "assistant",
      "content": "To implement pagination...",
      "timestamp": 1705747810000
    }
  ]
}
```

### Clear Session

```bash
curl -X DELETE http://localhost:3000/ai/chat/session_1705747800000_abc123 \
  -H "Authorization: Bearer $JWT_TOKEN"

# Response: 204 No Content
```

## 5️⃣ Test WebSocket Connection

### Using Node.js

```javascript
const io = require('socket.io-client');

const socket = io('ws://localhost:3000/chat', {
  auth: {
    token: 'YOUR_JWT_TOKEN',
    userId: 1,
    email: 'user@example.com',
  },
});

socket.on('connect', () => {
  console.log('✓ Connected to AI Chat');

  // Ask question
  socket.emit('ask_ai', {
    message: 'What is dependency injection?',
    sessionId: 'my-session-id',
  });
});

socket.on('stream_response', (data) => {
  process.stdout.write(data.chunk);
  if (data.isDone) {
    console.log('\n✓ Response complete');
  }
});

socket.on('sources', (data) => {
  console.log('\nSources:', data.sources);
});

socket.on('error', (error) => {
  console.error('✗ Error:', error);
});

socket.on('disconnect', () => {
  console.log('✗ Disconnected');
  process.exit(0);
});
```

### Using Browser (TypeScript)

```typescript
import { io, Socket } from 'socket.io-client';

const socket: Socket = io('ws://localhost:3000/chat', {
  auth: {
    token: localStorage.getItem('accessToken'),
    userId: currentUser.id,
    email: currentUser.email,
  },
});

socket.on('connect', () => {
  console.log('Connected!');
});

socket.emit('ask_ai', {
  message: 'Your question here?',
  sessionId: sessionId, // optional
});

socket.on('stream_response', (data) => {
  // Update UI with chunk
  responseText += data.chunk;
  updateUI(responseText);

  if (data.isDone) {
    // Save sessionId for next message
    currentSessionId = data.sessionId;
  }
});

socket.on('sources', (data) => {
  displaySources(data.sources);
});

socket.on('error', (error) => {
  showError(error.message);
});
```

## 6️⃣ Test Background AI Processing

### Create a New Post

```bash
curl -X POST http://localhost:3000/posts \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Advanced TypeScript Patterns",
    "content_markdown": "This post covers...",
    "tags": ["typescript", "patterns"]
  }'
```

### Watch Background Processing

**Check BullMQ queue status**:

```bash
# From application logs
# You should see:
# "AI processor job queued: ai-{postId}-{timestamp}"
# "Processing published post #{postId}"
# "Embedding generated for post #X: 768 dimensions"
# "Post #X tagged successfully: typescript, design-patterns, ..."
```

**Monitor with Redis CLI**:

```bash
redis-cli
> KEYS "bull:aiProcessor:*"
> LLEN "bull:aiProcessor:active"
> LLEN "bull:aiProcessor:delayed"
> LLEN "bull:aiProcessor:failed"
```

**Check Sentry for processing events**:

- Go to https://sentry.io
- Filter by tag: `operation: processor.process_published_post`
- Look for processing confirmations

## 7️⃣ Verify PostgreSQL Setup

```sql
-- Connect to your database
psql -U postgres -d devshare_forum_db

-- Verify pgvector extension
SELECT * FROM pg_extension WHERE extname = 'vector';
-- Expected: One row for vector extension

-- Check posts table has embedding column
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'posts' AND column_name = 'embedding';
-- Expected: embedding | vector

-- Create HNSW index for better performance (optional)
CREATE INDEX IF NOT EXISTS posts_embedding_hnsw ON posts
USING hnsw (embedding vector_cosine_ops)
WITH (m=16, ef_construction=200);

-- Verify index was created
SELECT * FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'posts'
AND indexname = 'posts_embedding_hnsw';
```

## 8️⃣ Check Sentry Monitoring

Visit your Sentry dashboard and verify:

```
Issues Dashboard:
✓ No errors from AiModule
✓ No rate limit errors (429)
✓ No quota errors (403)

Performance Tab:
✓ gemini.generate_text transactions
✓ gemini.generate_embedding transactions
✓ agent.execute_rag transactions
✓ processor.process_published_post transactions

Transaction Details:
✓ Average latency within expected ranges
✓ Error rate near 0%
✓ User impact tracked
```

**Sample Sentry Tags to Filter By**:

- `operation:gemini.generate_text`
- `operation:agent.execute_rag`
- `operation:processor.process_published_post`
- `error_type:rate_limit`
- `error_type:quota_exceeded`

## 9️⃣ Check Redis Connection

```bash
# Test Redis connectivity
redis-cli

# In Redis CLI:
> PING
PONG

> KEYS "embedding:post:*" | head -10
# Should show cached embeddings

> KEYS "chat:*" | head -10
# Should show chat sessions

> TTL "chat:1:session_abc123"
# Should show remaining TTL

> GET "embedding:post:1" | head -c 100
# Should show embedding vector data
```

## 🔟 Monitor Queue Processing

```bash
# Watch BullMQ dashboard (if installed)
npm install -D bull-board
npm run dev

# Or check logs in application
tail -f logs/application.log | grep "AI processor"

# Expected output:
# "AI processor job queued: ai-123-1705747800000"
# "Processing published post #123"
# "Embedding generated for post #123: 768 dimensions"
# "Post #123 tagged successfully: javascript, typescript"
```

## Troubleshooting

### ❌ "GEMINI_API_KEY is not set"

```bash
# Add to .env
GEMINI_API_KEY=your_actual_api_key

# Restart application
npm run start:dev
```

### ❌ "pgvector extension not found"

```sql
-- Connect to PostgreSQL and run:
CREATE EXTENSION vector;

-- Verify:
SELECT * FROM pg_extension WHERE extname = 'vector';
```

### ❌ "Redis connection refused"

```bash
# Start Redis
redis-server

# Or check if running:
redis-cli ping
# Should output: PONG
```

### ❌ "WebSocket connection fails"

```javascript
// Check:
1. JWT token is valid
2. CORS origin matches (check browser console for CORS errors)
3. WebSocket server is running (check logs for "Gateway initialized")
4. Port 3000 is accessible
```

### ❌ "Embedding generation times out"

```bash
# Check Gemini API status
# 1. Verify API key is valid
# 2. Check quota isn't exceeded
# 3. Check network connectivity
# 4. Increase timeout if needed (in gemini.service.ts)
```

### ❌ "Rate limit errors (429)"

```bash
# Solutions:
1. Wait and retry (exponential backoff already handles this)
2. Batch requests (fewer concurrent requests)
3. Contact Google Cloud for quota increase
4. Monitor in Sentry for frequency
```

## 📊 Performance Verification

### Expected Latencies

```
Query embedding generation:       200-500ms
pgvector similarity search:       50-150ms
Gemini text generation:           1-3s
Safety check:                     500-1000ms
Full RAG pipeline:                2-4s
WebSocket streaming (per 20 chars): 30ms
```

### Load Testing

```bash
# Test REST endpoint with 10 concurrent requests
for i in {1..10}; do
  curl -X POST http://localhost:3000/ai/chat \
    -H "Authorization: Bearer $JWT_TOKEN" \
    -d '{"message":"test"}' &
done
wait

# Check queue depth
redis-cli LLEN "bull:aiProcessor:active"

# Monitor Sentry for errors
```

## ✅ Success Checklist

- [x] Gemini API key configured
- [x] PostgreSQL pgvector working
- [x] Redis connected
- [x] BullMQ queues initialized
- [x] WebSocket gateway online
- [x] REST API responding
- [x] Background jobs processing
- [x] Sentry tracking events
- [x] Session storage working
- [x] Embeddings persisting to DB

## 🚀 You're Ready!

Your production-grade agentic AI system is now operational and ready for:

✅ Real-time RAG chatbot via REST/WebSocket  
✅ Background content processing with embeddings  
✅ Automatic moderation and tagging  
✅ Full error tracking and monitoring  
✅ Scalable multi-turn conversations

**Start building! 🎉**
