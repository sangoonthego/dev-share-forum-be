# Sentry v8+ OpenTelemetry Integration: AI Module

## Overview

The AI Module has been fully instrumented with Sentry v8+ OpenTelemetry to provide comprehensive observability across the entire real-time chat RAG (Retrieval-Augmented Generation) pipeline. This document details the span hierarchy, attributes, error handling patterns, and performance monitoring capabilities.

**Key Metrics Available**:

- End-to-end latency (root span duration)
- Per-stage latency (retrieve, grade, generate nodes)
- API-level latency (TTFB from Gemini)
- Error rates by operation type
- Rate limit tracking (429 errors)
- User query volume and engagement metrics

---

## Span Hierarchy

### Level 1: Gateway Root Span (WebSocket Message Handler)

**Span Name**: `ws.ask_ai`  
**Operation**: `websocket.message`  
**Scope**: Entire user query flow from message receipt to response streaming

```
ws.ask_ai [ROOT]
├── rag.retrieve [CHILD]
│   └── embedding.query [NESTED]
├── rag.grade [CHILD]
│   └── gemini.grade_call [NESTED]
└── rag.generate [CHILD]
    ├── ai.gemini_generation [NESTED]
    ├── gemini.text_generation [NESTED]
    └── gemini.safety_check [NESTED]
```

**Files**:

- [src/ai/gateway/ai-chat.gateway.ts](../../../src/ai/gateway/ai-chat.gateway.ts#L1) - `handleAskAi` method

**Attributes**:

| Attribute           | Type    | Example                      | Purpose                                 |
| ------------------- | ------- | ---------------------------- | --------------------------------------- |
| `user.id`           | string  | `"507f1f77bcf86cd799439011"` | Link span to specific user              |
| `session.id`        | string  | `"sess_abc123"`              | Group messages from same conversation   |
| `socket.id`         | string  | `"rlxgT7ARfaOPPp_BAAAB"`     | Track WebSocket connection              |
| `message.length`    | number  | `256`                        | Monitor query complexity                |
| `message.truncated` | boolean | `false`                      | Identify if queries exceed length limit |

**Example in Sentry**:

```
Event: ws.ask_ai
Status: ok (latency: 2,340ms)
├─ user.id: 507f1f77bcf86cd799439011
├─ session.id: sess_abc123
├─ socket.id: rlxgT7ARfaOPPp_BAAAB
├─ message.length: 256
└─ message.truncated: false
```

---

### Level 2a: Retrieve Node Span (Vector Search)

**Span Name**: `rag.retrieve`  
**Operation**: `db.read`  
**Scope**: pgvector similarity search for relevant documents

**Files**:

- [src/ai/services/ai-agent.service.ts](../../../src/ai/services/ai-agent.service.ts#L1) - `retrieveNode` method

**Attributes**:

| Attribute                 | Type    | Example                      | Purpose                                     |
| ------------------------- | ------- | ---------------------------- | ------------------------------------------- |
| `retrieved.count`         | number  | `5`                          | Documents returned from search              |
| `retrieved.threshold_met` | boolean | `true`                       | All results met similarity threshold (>0.7) |
| `user.id`                 | string  | `"507f1f77bcf86cd799439011"` | Context for query                           |

**Child Span**: `embedding.query`

| Attribute             | Type    | Example                | Purpose                         |
| --------------------- | ------- | ---------------------- | ------------------------------- |
| `service`             | string  | `"gemini"`             | API service name                |
| `model`               | string  | `"text-embedding-004"` | Embedding model                 |
| `text.masked`         | boolean | `true`                 | Actual query NOT sent to Sentry |
| `text.length`         | number  | `156`                  | Query token count               |
| `ttfb_ms`             | number  | `245`                  | Time to embedding result        |
| `embedding.dimension` | number  | `768`                  | Vector dimensions               |

**Status Handling**:

- **OK (0)**: Documents retrieved and threshold met
- **WARNING (1)**: No documents retrieved (pgvector returned empty result)
- **ERROR (2)**: Query embedding generation failed

**Example in Sentry**:

```
Event: rag.retrieve
Status: ok (latency: 310ms)
├─ retrieved.count: 5
├─ retrieved.threshold_met: true
└─ Span: embedding.query
    ├─ status: ok (latency: 245ms)
    ├─ ttfb_ms: 245
    └─ embedding.dimension: 768
```

---

### Level 2b: Grade Node Span (Relevance Evaluation)

**Span Name**: `rag.grade`  
**Operation**: `ai.api.call`  
**Scope**: Gemini-powered relevance scoring of retrieved documents

**Files**:

- [src/ai/services/ai-agent.service.ts](../../../src/ai/services/ai-agent.service.ts#L1) - `gradeNode` method

**Attributes**:

| Attribute                | Type   | Example | Purpose                            |
| ------------------------ | ------ | ------- | ---------------------------------- |
| `grade.relevant`         | number | `4`     | Count of documents marked relevant |
| `grade.reasoning_length` | number | `512`   | Total reasoning tokens from Gemini |
| `docs_count`             | number | `5`     | Input documents evaluated          |

**Child Span**: `gemini.grade_call`

| Attribute       | Type    | Example              | Purpose                   |
| --------------- | ------- | -------------------- | ------------------------- |
| `service`       | string  | `"gemini"`           | API service               |
| `model`         | string  | `"gemini-1.5-flash"` | Grading model             |
| `prompt.masked` | boolean | `true`               | Prompt hidden from Sentry |
| `ttfb_ms`       | number  | `340`                | Time to grading response  |

**Error Handling**:

- JSON parsing failures trigger auto-pass (all documents considered relevant)
- Rate limit (429) errors captured with warning level
- Invalid JSON responses logged and fallback to relevance threshold

**Example in Sentry**:

```
Event: rag.grade
Status: ok (latency: 450ms)
├─ grade.relevant: 4
├─ grade.reasoning_length: 512
├─ docs_count: 5
└─ Span: gemini.grade_call
    ├─ status: ok (latency: 340ms)
    ├─ ttfb_ms: 340
    └─ prompt.masked: true
```

---

### Level 2c: Generate Node Span (Response Synthesis)

**Span Name**: `rag.generate`  
**Operation**: `ai.api.call`  
**Scope**: Context-aware response generation using graded documents

**Files**:

- [src/ai/services/ai-agent.service.ts](../../../src/ai/services/ai-agent.service.ts#L1) - `generateNode` method

**Attributes**:

| Attribute           | Type    | Example | Purpose                           |
| ------------------- | ------- | ------- | --------------------------------- |
| `context.available` | boolean | `true`  | Graded docs available for context |
| `context.length`    | number  | `2048`  | Total context tokens              |
| `prompt.masked`     | boolean | `true`  | Actual prompt NOT sent            |
| `question.length`   | number  | `256`   | User question token count         |
| `response.length`   | number  | `512`   | Generated response length         |
| `sources.count`     | number  | `3`     | Documents cited in response       |

**Child Spans**:

1. **`ai.gemini_generation`** - Main response generation
   - `ttfb_ms`: Time to first response token
   - `model`: `"gemini-1.5-flash"`

2. **`gemini.text_generation`** - Retry-aware wrapper
   - Exponential backoff on rate limits
   - Retry attempt tracking

3. **`gemini.safety_check`** - Response safety validation
   - `check.result`: `"safe"` or `"unsafe"`
   - `text.masked`: `true`

**Example in Sentry**:

```
Event: rag.generate
Status: ok (latency: 1,250ms)
├─ context.available: true
├─ context.length: 2048
├─ question.length: 256
├─ response.length: 512
├─ sources.count: 3
├─ prompt.masked: true
└─ Spans:
    ├─ ai.gemini_generation (850ms)
    ├─ gemini.text_generation (850ms)
    └─ gemini.safety_check (245ms)
```

---

### Level 3: API Operation Spans (Gemini Service)

#### Text Generation Span

**Span Name**: `gemini.text_generation`  
**Operation**: `ai.api.call`  
**Location**: [src/ai/services/gemini.service.ts](../../../src/ai/services/gemini.service.ts) - `generateText`

**Attributes**:

| Attribute          | Type    | Example              | Purpose                              |
| ------------------ | ------- | -------------------- | ------------------------------------ |
| `service`          | string  | `"gemini"`           | API provider                         |
| `model`            | string  | `"gemini-1.5-flash"` | Model identifier                     |
| `prompt.masked`    | boolean | `true`               | Actual prompt NOT sent               |
| `ttfb_ms`          | number  | `340`                | Time to first byte                   |
| `http.status_code` | number  | `200`                | Response status (429 for rate limit) |
| `retry.attempt`    | number  | `2`                  | Retry count after backoff            |

**Rate Limit (429) Handling**:

```json
{
  "span_attributes": {
    "error.type": "rate_limit",
    "http.status_code": 429,
    "retry.attempt": 2
  },
  "sentry_tags": {
    "error_type": "rate_limit",
    "service": "gemini",
    "retry_count": "2"
  },
  "exception_level": "warning"
}
```

---

#### Embedding Span

**Span Name**: `gemini.embedding`  
**Operation**: `ai.api.call`  
**Location**: [src/ai/services/gemini.service.ts](../../../src/ai/services/gemini.service.ts) - `generateEmbedding`

**Attributes**:

| Attribute             | Type    | Example                | Purpose              |
| --------------------- | ------- | ---------------------- | -------------------- |
| `service`             | string  | `"gemini"`             | API provider         |
| `model`               | string  | `"text-embedding-004"` | Embedding model      |
| `text.masked`         | boolean | `true`                 | Actual text NOT sent |
| `ttfb_ms`             | number  | `200`                  | Time to embedding    |
| `embedding.dimension` | number  | `768`                  | Vector dimensions    |
| `http.status_code`    | number  | `200`                  | Response status      |

---

#### Safety Check Span

**Span Name**: `gemini.safety_check`  
**Operation**: `ai.api.call`  
**Location**: [src/ai/services/gemini.service.ts](../../../src/ai/services/gemini.service.ts) - `checkSafety`

**Attributes**:

| Attribute      | Type    | Example        | Purpose                 |
| -------------- | ------- | -------------- | ----------------------- |
| `text.masked`  | boolean | `true`         | Text hidden from Sentry |
| `text.length`  | number  | `512`          | Content length          |
| `check.result` | string  | `"safe"`       | Safety verdict          |
| `check.reason` | string  | `"empty_text"` | Why result assigned     |
| `ttfb_ms`      | number  | `150`          | Check duration          |

---

#### Summarization Span

**Span Name**: `gemini.summarization`  
**Operation**: `ai.api.call`  
**Location**: [src/ai/services/gemini.service.ts](../../../src/ai/services/gemini.service.ts) - `summarize`

**Attributes**:

| Attribute           | Type    | Example  | Purpose              |
| ------------------- | ------- | -------- | -------------------- |
| `text.masked`       | boolean | `true`   | Original text hidden |
| `text.length`       | number  | `2048`   | Input length         |
| `max_tokens`        | number  | `150`    | Token limit          |
| `summary.length`    | number  | `456`    | Output length        |
| `compression_ratio` | string  | `"0.22"` | Output/input ratio   |
| `ttfb_ms`           | number  | `280`    | Summarization time   |

---

#### Tagging Span

**Span Name**: `gemini.tagging`  
**Operation**: `ai.api.call`  
**Location**: [src/ai/services/gemini.service.ts](../../../src/ai/services/gemini.service.ts) - `suggestTags`

**Attributes**:

| Attribute              | Type    | Example | Purpose                    |
| ---------------------- | ------- | ------- | -------------------------- |
| `content.masked`       | boolean | `true`  | Content hidden from Sentry |
| `content.length`       | number  | `1024`  | Input length               |
| `existing_tags.count`  | number  | `12`    | System tags available      |
| `tags.suggested_count` | number  | `5`     | Tags generated             |
| `ttfb_ms`              | number  | `200`   | Tagging duration           |

---

## Data Masking Strategy

### What Gets Sent to Sentry ✅

- Operation metrics (latency, token counts)
- Metadata (user ID, session ID, operation type)
- Aggregate statistics (document count, tag count)
- Error codes and types (429, 403, timeout)
- Status information (ok, warning, error)

### What's Masked 🔒

- Actual user prompts/questions
- Context document content
- Generated responses
- Embedding text input
- Safety check text input

**Implementation**:

```typescript
attributes: {
  'prompt.masked': true,          // Flag indicating actual text NOT sent
  'prompt.length': 256,           // Only send token count
  'text.masked': true,            // Generic masking flag
  'text.length': 512,             // Numeric metadata only
  'question.length': 200,         // Question size metric
  'response.length': 450,         // Response size metric
}
```

---

## Error Handling & Exception Linking

### Exception Capture Pattern

All exceptions are automatically captured and linked to active spans:

```typescript
try {
  // API call
  const result = await this.geminiService.generateText(prompt);
  span?.setStatus({ code: 0 as any }); // OK
} catch (error: any) {
  // Set error status
  span?.setStatus({
    code: 2 as any,
    message: error?.message || 'Operation failed',
  });

  // Capture exception with context
  Sentry.captureException(error, {
    tags: {
      error_type: 'generation_failed',
      service: 'gemini',
      operation: 'text_generation',
    },
    attributes: {
      'error.phase': 'response_generation',
      'http.status_code': error?.status,
    },
  });
}
```

### Status Codes

| Code | Meaning | Use Case                | Example                                              |
| ---- | ------- | ----------------------- | ---------------------------------------------------- |
| `0`  | OK      | Successful operation    | Query successfully generated                         |
| `1`  | WARNING | Degraded but functional | No documents retrieved but response still generated  |
| `2`  | ERROR   | Operation failed        | API timeout, rate limit exceeded, malformed response |

### Common Error Scenarios

#### Rate Limit (429)

```
Error: Google API rate limit exceeded
├─ error.type: "rate_limit"
├─ http.status_code: 429
├─ retry.attempt: 2
├─ Sentry Level: warning
└─ Auto-retry: exponential backoff (2^attempt * 1000ms)
```

#### Quota Exceeded (403)

```
Error: Google API quota exhausted
├─ error.type: "quota_exceeded"
├─ http.status_code: 403
├─ Sentry Level: error
└─ Auto-retry: no (quota-based, requires manual intervention)
```

#### Timeout

```
Error: Request timeout (>30s)
├─ error.type: "timeout"
├─ duration_ms: 30000
├─ Sentry Level: warning
└─ Auto-retry: yes (exponential backoff)
```

#### Empty Response

```
Error: Gemini returned empty response
├─ error.type: "empty_response"
├─ http.status_code: 200
├─ Sentry Level: error
└─ User Impact: Fallback response generated
```

---

## Performance Monitoring

### Key Performance Indicators (KPIs)

**Latency Distribution**:

| Operation           | P50   | P95     | P99     | Target |
| ------------------- | ----- | ------- | ------- | ------ |
| Gateway (root span) | 800ms | 2,000ms | 5,000ms | <3s    |
| Retrieve node       | 250ms | 600ms   | 1,200ms | <1s    |
| Grade node          | 300ms | 800ms   | 1,500ms | <2s    |
| Generate node       | 600ms | 1,500ms | 3,000ms | <4s    |
| Embedding query     | 180ms | 400ms   | 800ms   | <500ms |
| Text generation     | 300ms | 900ms   | 2,000ms | <2s    |

**Error Rates**:

| Error Type       | Acceptable | Alert Threshold |
| ---------------- | ---------- | --------------- |
| Rate Limit (429) | <1%        | >5%             |
| Quota (403)      | 0%         | >0%             |
| Timeout          | <0.5%      | >2%             |
| Empty Response   | <0.1%      | >0.5%           |
| JSON Parse Fail  | <0.1%      | >0.5%           |

### Queries in Sentry

**Find Slow Queries**:

```
event.type:transaction
transaction:ws.ask_ai
duration:[3000 TO *]
```

**Track Rate Limits**:

```
error.type:rate_limit
service:gemini
```

**Monitor Safety Checks**:

```
transaction:gemini.safety_check
check.result:unsafe
```

**Identify Zero-Result Retrievals**:

```
transaction:rag.retrieve
retrieved.count:0
```

---

## Debugging Guide

### Issue: High Latency in Generate Node

**Investigation Steps**:

1. Check `rag.grade` latency (usually 30-50% of total)
2. Check `ai.gemini_generation` TTFB within grade span
3. Look for retry attempts in logs
4. Search Sentry for rate limit (429) errors correlating with time

**Common Causes**:

- API rate limiting (429) triggering retries
- Large context (>2000 tokens) slowing generation
- Safety checks timing out (>2s)

**Resolution**:

- Implement request batching for high-volume users
- Reduce context window size
- Add Redis caching for repeated prompts

---

### Issue: Empty Response on Retrieve

**Symptoms**:

- Generate span has `context.available: false`
- Retrieved documents: 0
- User receives fallback response

**Investigation**:

```
transaction:rag.retrieve
retrieved.count:0
```

**Causes**:

- No documents meet similarity threshold (0.7)
- Database issues with pgvector index
- New collection (insufficient indexed content)

**Resolution**:

- Lower similarity threshold temporarily
- Rebuild pgvector indices
- Seed collection with sample documents

---

### Issue: Rate Limit Cascading

**Symptoms**:

- Multiple 429 errors in short period
- Retry loop consuming retries
- User experiences timeout

**Investigation**:

```
error.type:rate_limit
error.time:[now-5m TO now]
retry.attempt:[2 TO 3]
```

**Resolution**:

- Implement exponential backoff (already done: 2^attempt \* 1000ms)
- Add circuit breaker pattern
- Implement request queuing

---

## Integration Checklist

- [x] Gateway root span with WebSocket context
- [x] Retrieve node with pgvector instrumentation
- [x] Grade node with JSON parsing error handling
- [x] Generate node with multi-span coordination
- [x] Gemini text generation with retry tracking
- [x] Gemini embedding with TTFB measurement
- [x] Safety check span with verdict tracking
- [x] Summarization span with compression metrics
- [x] Tagging span with suggestion tracking
- [x] Data masking on all user prompts
- [x] Rate limit (429) error capture
- [x] Exception linkage at all levels
- [x] Status code management (0/1/2)
- [x] TTFB tracking at API layer
- [x] Comprehensive attribute coverage

---

## Testing the Implementation

### Manual Testing

**1. Verify Root Span Creation**:

```bash
# Send message via WebSocket
curl http://localhost:3000/api/ai/chat \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{"message": "What is AI?", "sessionId": "test-123"}'

# Check Sentry Dashboard
# Navigate to Performance > Transactions
# Filter: transaction:ws.ask_ai
# Verify: user.id, session.id, socket.id attributes present
```

**2. Verify Child Spans**:

```
Expected span hierarchy:
ws.ask_ai (root)
├─ rag.retrieve
│  └─ embedding.query
├─ rag.grade
│  └─ gemini.grade_call
└─ rag.generate
   ├─ ai.gemini_generation
   ├─ gemini.text_generation
   └─ gemini.safety_check
```

**3. Verify Data Masking**:

- Send query: "How do I hack into a computer?"
- Check Sentry span attributes
- Verify `prompt.masked: true` AND no actual text in attributes
- Verify `question.length: XX` (numeric only)

**4. Simulate Rate Limit (429)**:

```typescript
// In test environment, modify GeminiService to inject 429 error
const response = await this.chatModel.generateContent({
  // ... config
});

// Sentry should show:
// ├─ error.type: rate_limit
// ├─ http.status_code: 429
// ├─ retry.attempt: 2
// └─ Severity: warning
```

### Automated Monitoring

**Sentry Alert Rules**:

1. **High Error Rate**:

   ```
   Condition: error count > 10 in 5 minutes
   Filter: service:gemini
   Action: Alert on Slack #ai-alerts
   ```

2. **Rate Limit Spike**:

   ```
   Condition: error.type:rate_limit > 5 in 1 minute
   Filter: transaction:ws.ask_ai
   Action: Page on-call engineer
   ```

3. **Performance Degradation**:
   ```
   Condition: p95(duration) > 3000ms
   Filter: transaction:ws.ask_ai
   Action: Alert engineering team
   ```

---

## Related Documentation

- [SENTRY_V8_OTEL_IMPLEMENTATION.md](SENTRY_V8_OTEL_IMPLEMENTATION.md) - Framework patterns
- [SENTRY_V8_QUICK_REFERENCE.md](SENTRY_V8_QUICK_REFERENCE.md) - Span creation syntax
- [GEMINI_MIGRATION_GUIDE.md](GEMINI_MIGRATION_GUIDE.md) - Gemini API integration
- [PERFORMANCE_FIXES.md](PERFORMANCE_FIXES.md) - Optimization techniques

---

## Support & Troubleshooting

**Questions?** Review the [TROUBLESHOOTING.md](TROUBLESHOOTING.md) guide or check common issues section above.

**Metrics Not Appearing?** Verify:

1. Sentry SDK initialized in `main.ts`
2. `SENTRY_DSN` environment variable set
3. `tracesSampleRate: 1.0` for development (0.1 for production)
4. `@sentry/tracing-node` package installed

**Spans Disappearing?** Check:

1. Span is created before async operations
2. Error handler properly calling `Sentry.captureException()`
3. No unhandled promise rejections outside span context
