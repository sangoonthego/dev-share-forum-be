# Architecture Diagram - Agentic AI System

## 1. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                             │
├──────────────────────────────────────┬──────────────────────────┤
│  REST Client                         │  WebSocket Client        │
│  POST /ai/chat                       │  ask_ai event            │
│  GET /ai/chat/:sessionId             │  stream_response listen  │
│  DELETE /ai/chat/:sessionId          │  sources listen          │
└──────────────────────┬────────────────┴──────────────┬───────────┘
                       │ HTTP                          │ WebSocket
                       │                               │
┌──────────────────────────────────────────────────────────────────┐
│                     NESTJS GATEWAY/CONTROLLER                    │
├──────────────────────┬───────────────────────────────┬───────────┤
│  JwtGuard (Auth)     │                               │           │
│  AiController        │  AiChatGateway                │ Socket.io │
│  POST /ai/chat       │  namespace: /chat             │           │
│  GET /ai/chat/*      │  Real-time streaming          │           │
│  DELETE /ai/chat/*   │                               │           │
└──────────────────────┴───────────────────────────────┴───────────┘
                       │
       ┌───────────────┼───────────────┐
       │               │               │
       ▼               ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ AiAgent      │ │ GeminiService│ │ AiEmbedding  │
│ Service      │ │              │ │ Service      │
├──────────────┤ ├──────────────┤ ├──────────────┤
│ • Retrieve   │ │ • generateText    │ │ • generate()     │
│ • Grade      │ │ • stream()         │ │ • save()         │
│ • Generate   │ │ • generateEmbedding│ │ • findSimilar()  │
│ • Memory mgmt│ │ • checkSafety()    │ │ • cache/retrieve │
└──────────────┘ │ • summarize()      │ └──────────────────┘
                 │ • suggestTags()    │
                 └────────────────────┘
                       │
                       ▼
            ┌──────────────────────┐
            │  Google Gemini API   │
            ├──────────────────────┤
            │ • gemini-1.5-flash   │
            │ • text-embedding-004 │
            └──────────────────────┘
```

## 2. RAG Agent Pipeline

```
                         User Query
                             │
                             ▼
                    ┌──────────────────┐
                    │  Query received  │
                    │ (JwtGuard auth)  │
                    └────────┬─────────┘
                             │
                   ┌─────────┴─────────┐
                   │                   │
                   ▼                   ▼
            ┌─────────────┐    ┌──────────────┐
            │  REST Path  │    │ WebSocket    │
            │ /ai/chat    │    │ ask_ai event │
            └──────┬──────┘    └──────┬───────┘
                   │                  │
                   └────────┬─────────┘
                            │
                 ┌──────────┴──────────┐
                 │                     │
                 ▼                     ▼
      ┌──────────────────┐  ┌──────────────────┐
      │ Create Chat      │  │ Get existing or  │
      │ Context (Redis)  │  │ create session   │
      └────────┬─────────┘  └────────┬─────────┘
               │                     │
               └──────────┬──────────┘
                          │
                          ▼
              ┌───────────────────────┐
              │  [NODE 1] RETRIEVE    │
              ├───────────────────────┤
              │ 1. Generate query     │
              │    embedding via      │
              │    Gemini             │
              │ 2. Call pgvector      │
              │    similarity search  │
              │ 3. Return top 5 posts │
              │    (similarity > 0.7) │
              └────────────┬──────────┘
                           │
                    Retrieved Docs
                           │
                           ▼
              ┌───────────────────────┐
              │  [NODE 2] GRADE       │
              ├───────────────────────┤
              │ 1. Call Gemini to     │
              │    evaluate relevance │
              │ 2. JSON response:     │
              │ { relevant: bool,     │
              │   reasoning: str }    │
              │ 3. Graceful degrade   │
              │    if fails           │
              └────────────┬──────────┘
                           │
                   Grade Result
                           │
                           ▼
              ┌───────────────────────┐
              │  [NODE 3] GENERATE    │
              ├───────────────────────┤
              │ 1. Combine context:   │
              │    • Docs + scores    │
              │    • Chat history     │
              │    • Original query   │
              │ 2. Prompt Gemini      │
              │ 3. Extract citations  │
              │    [Title](slug)      │
              │ 4. Return response    │
              └────────────┬──────────┘
                           │
                    Generated Response
                    + Sources + SessionId
                           │
                    ┌──────┴──────┐
                    │             │
                    ▼             ▼
              ┌─────────────┐ ┌──────────────┐
              │ REST API    │ │ WebSocket    │
              │ Return JSON │ │ Stream chunks│
              │             │ │ 30ms delay   │
              │             │ │ Send sources │
              └─────────────┘ └──────────────┘
```

## 3. Background Processing Pipeline

```
┌──────────────────────────────────────────────────────────┐
│              POST PUBLISHED EVENT                        │
│  (e.g., user creates new forum post)                     │
└────────────────────┬─────────────────────────────────────┘
                     │
                     ▼
      ┌──────────────────────────────┐
      │ Post Publish Service         │
      │ processPublishedPost()       │
      └────────────┬─────────────────┘
                   │
                   ▼
      ┌──────────────────────────────┐
      │ Queue AI Processor Job       │
      │ (Bull Queue: aiProcessor)    │
      │ Retry: 3 attempts            │
      │ Backoff: exponential (2s)    │
      └────────────┬─────────────────┘
                   │
           ┌───────┴───────┬──────────┐
           │               │          │
           ▼               ▼          ▼
    ┌────────────┐  ┌────────────┐ ┌──────────────┐
    │ TASK 1     │  │ TASK 2     │ │ TASK 3       │
    │ EMBEDDING  │  │ SAFETY     │ │ TAGGING      │
    └────────────┘  └────────────┘ └──────────────┘
           │               │          │
           ▼               ▼          ▼
    ┌────────────────────────────────────────┐
    │ PARALLEL EXECUTION (all 3 together)    │
    │ Each wrapped in try-catch + Sentry     │
    └────────────────────────────────────────┘
           │               │          │
           ▼               ▼          ▼
    ┌──────────┐   ┌────────────┐ ┌────────────┐
    │Task 1:   │   │Task 2:     │ │Task 3:     │
    │Generate  │   │Check with  │ │Suggest     │
    │embedding │   │Gemini      │ │tags with   │
    │          │   │            │ │Gemini      │
    ├──────────┤   ├────────────┤ ├────────────┤
    │ 1. Call  │   │ 1. Call    │ │ 1. Get    │
    │    Gemini│   │    Gemini  │ │    existing│
    │    embed │   │    safety  │ │    tags   │
    │    API   │   │    API     │ │ 2. Call   │
    │          │   │ 2. If      │ │    Gemini │
    │ 2. Save  │   │    unsafe: │ │    suggest│
    │    to DB │   │    archive │ │ 3. Upsert │
    │    (768  │   │    post    │ │    tags   │
    │    dims) │   │ 3. Notify  │ │ 4. Attach │
    │          │   │    admins  │ │    to post│
    │ 3. Cache │   │            │ │            │
    │    in    │   │            │ │            │
    │    Redis │   │            │ │            │
    └────────────────────────────────────────┘
           │               │          │
           ▼               ▼          ▼
    ┌──────────────────────────────────────────┐
    │ Await ALL tasks completion               │
    │ (Failed tasks don't block others)        │
    │ Report to Sentry with results            │
    └────────────────────────────────────────────┘
           │               │          │
           └───────────────┼──────────┘
                           │
                           ▼
              ┌──────────────────────┐
              │ Job Complete         │
              │ (success or partial) │
              │                      │
              │ Post now:            │
              │ ✓ Has embedding      │
              │ ✓ Verified safe      │
              │ ✓ Has auto-tags      │
              │                      │
              │ If unsafe:           │
              │ ✗ Status = ARCHIVED  │
              │ ✗ Admin notified     │
              └──────────────────────┘
```

## 4. Data Flow - Embeddings

```
                        Post Content
                  (title + markdown)
                            │
                            ▼
                ┌───────────────────────┐
                │ GeminiService         │
                │ .generateEmbedding()  │
                ├───────────────────────┤
                │ Call Google API:      │
                │ model: text-embedding-│
                │ 004                   │
                │ Returns: 768-dim vec  │
                └────────┬──────────────┘
                         │
            ┌────────────┴────────────┐
            │                         │
            ▼                         ▼
      ┌──────────────┐        ┌──────────────┐
      │  Redis Cache │        │  PostgreSQL  │
      │              │        │              │
      │ Key:         │        │ Table: posts │
      │ embedding:   │        │ Col: embed   │
      │ post:{id}    │        │ Type:        │
      │              │        │ vector(768)  │
      │ Value:       │        │              │
      │ [0.1, 0.2..]│        │ Insert via   │
      │              │        │ raw SQL:     │
      │ TTL: 24h     │        │ embedding =  │
      │              │        │ $1::vector() │
      └──────────────┘        └──────────────┘
            │                         │
            └────────────┬────────────┘
                         │
                         ▼
            ┌──────────────────────────┐
            │ Embeddings Persisted:    │
            │ ✓ Fast retrieval         │
            │ ✓ Similarity search      │
            │ ✓ Backup in Redis        │
            └──────────────────────────┘
```

## 5. Data Flow - Similarity Search

```
                    User Query
                 "How to build an API?"
                          │
                          ▼
        ┌─────────────────────────────┐
        │ GeminiService               │
        │ .generateEmbedding(query)   │
        │                             │
        │ Returns: 768-dim vector     │
        └────────────┬────────────────┘
                     │
                     ▼
        ┌──────────────────────────────┐
        │ AiEmbedding Service          │
        │ .findSimilarPosts(            │
        │   queryVector,               │
        │   limit=5,                   │
        │   threshold=0.7)             │
        └────────────┬─────────────────┘
                     │
                     ▼
        ┌──────────────────────────────┐
        │ PostgreSQL / pgvector        │
        │                              │
        │ Query:                       │
        │ SELECT p.id, p.title,        │
        │   (1 - (embedding <=>       │
        │    $1::vector) / 2) AS sim  │
        │ FROM posts p                 │
        │ WHERE sim > 0.7              │
        │ ORDER BY embedding <=> $1   │
        │ LIMIT 5                      │
        │                              │
        │ Using: <=> operator          │
        │ (cosine similarity)          │
        │                              │
        │ Index: HNSW (optional)       │
        │ Lookup: ~50-150ms            │
        └────────────┬─────────────────┘
                     │
                     ▼
        ┌──────────────────────────────┐
        │ Top 5 Similar Posts          │
        │ - Post A (sim: 0.92)         │
        │ - Post B (sim: 0.88)         │
        │ - Post C (sim: 0.81)         │
        │ - Post D (sim: 0.78)         │
        │ - Post E (sim: 0.75)         │
        │                              │
        │ All > 0.7 threshold ✓        │
        └──────────────────────────────┘
```

## 6. WebSocket Event Flow

```
                    CLIENT                          SERVER
                      │                               │
                      │  io.connect(...)              │
                      ├──────────────────────────────>│
                      │  { JWT, userId, email }       │
                      │                               │
                      │<──────────────────────────────┤
                      │  'connect' event              │
                      │  (socket verified)            │
                      │                               │
                      │  emit('ask_ai', {message})    │
                      ├──────────────────────────────>│
                      │  { message, sessionId? }      │
                      │                               │
                      │                        [Query embedding]
                      │                        [pgvector search]
                      │                        [Gemini grade]
                      │                        [Gemini generate]
                      │<──────────────────────────────┤
                      │  'stream_response'            │
                      │  { chunk, isDone }            │
                      │                               │
                      │<──────────────────────────────┤
                      │  'stream_response'            │
                      │  [more chunks...]             │
                      │  30ms between chunks          │
                      │                               │
                      │<──────────────────────────────┤
                      │  'stream_response'            │
                      │  { chunk: "", isDone: true }  │
                      │                               │
                      │<──────────────────────────────┤
                      │  'sources'                    │
                      │  { sources: [...] }           │
                      │                               │
                      │  emit('clear_session', {...}) │
                      ├──────────────────────────────>│
                      │                               │
                      │<──────────────────────────────┤
                      │  'session_cleared'            │
                      │                               │
                      │  io.disconnect()              │
                      ├──────────────────────────────>│
                      │                               │
                      │<──────────────────────────────┤
                      │  'disconnect'                 │
```

## 7. Multi-Layer Error Handling

```
┌────────────────────────────────────────────────────────┐
│                   ERROR HANDLING LAYERS                │
└────────────────────────────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
    ┌──────────┐    ┌──────────┐    ┌──────────┐
    │ Layer 1  │    │ Layer 2  │    │ Layer 3  │
    │ Gemini   │    │ Database │    │ Redis    │
    └──────────┘    └──────────┘    └──────────┘
          │                │                │
          ▼                ▼                ▼
    ┌──────────────────────────────────────────┐
    │       TRY-CATCH + SENTRY REPORTING       │
    └──────────┬────────────────────────────────┘
               │
      ┌────────┴────────┐
      │                 │
      ▼                 ▼
    ┌─────────┐    ┌─────────────┐
    │ Transient   │ │ Permanent   │
    │ Errors (429)│ │ Errors (403)│
    │ Timeout     │ │ Auth failed │
    ├─────────┤ ├─────────────┤
    │ RETRY   │ │ FAIL        │
    │ x3 with │ │ Throw to    │
    │ backoff │ │ client      │
    │ 1s→2s→ │ │ + Sentry    │
    │ 4s      │ │             │
    └─────────┘ └─────────────┘
```

## 8. Storage Architecture

```
┌──────────────────────────────────────────────────────────┐
│                   STORAGE LAYERS                         │
└──────────────────────────────────────────────────────────┘
        │                   │                    │
        ▼                   ▼                    ▼
   ┌─────────┐         ┌──────────┐        ┌──────────┐
   │ Redis   │         │PostgreSQL│        │ Gemini   │
   │ Cache   │         │ Database │        │ (API)    │
   ├─────────┤         ├──────────┤        ├──────────┤
   │ Fast    │         │ Durable  │        │ External │
   │ Hot     │         │ ACID     │        │ Service  │
   │ Data    │         │ History  │        │          │
   └─────────┘         └──────────┘        └──────────┘
        │                   │
        │                   ▼
        │        ┌──────────────────────┐
        │        │ posts table          │
        │        │ - id, title, slug    │
        │        │ - content_markdown   │
        │        │ - status             │
        │        │ - embedding (768-dim)│ <─┐
        │        │ - deleted_at         │   │
        │        │ - tags (via M2M)     │   │
        │        │ - author_id          │   │
        │        └──────────────────────┘   │
        │                                   │
        ├─ Embeddings ──────────────────────┘
        │
        ├─ Cache Keys:
        │   • embedding:post:{id}
        │   • chat:{userId}:{sessionId}
        │
        └─ TTLs:
            • Embeddings: 24 hours
            • Chat: 7 days
```

---

This architecture provides:

- ✅ **Scalability**: Horizontal scaling of workers
- ✅ **Reliability**: Retry logic + fallbacks
- ✅ **Performance**: Caching + async processing
- ✅ **Monitoring**: Full Sentry integration
- ✅ **Flexibility**: Modular component design
