# Sentry v8+ OpenTelemetry Implementation Guide

## AI Post Processor Worker

### Overview

The `ai-post-processor.worker.ts` module has been fully instrumented with **Sentry v8+ OpenTelemetry standards**, providing complete observability across all business logic flows with root spans, child spans, rich attributes, and exception mapping.

---

## Architecture

### Root Span: `processPublishedPost`

**Operation**: `queue.process`

The primary transaction that encompasses the entire post processing workflow.

```typescript
Sentry.startSpan(
  {
    name: 'processPublishedPost',
    op: 'queue.process',
    attributes: {
      'post.id': postId,
      'user.id': authorId,
      'queue.job.id': job.id?.toString(),
      'queue.name': 'aiProcessor',
      'queue.processor': 'processPublishedPost',
    },
  },
  async (rootSpan) => { ... }
);
```

**Attributes Tracked**:

- `post.id`: Post identifier
- `user.id`: Author/User identifier
- `queue.job.id`: BullMQ job ID
- `queue.name`: Queue name
- `queue.processor`: Processor function name

**Span Status**:

- ✅ `ok` - All tasks completed successfully
- ❌ `error` - Error occurred during processing with error message

**Result Attributes** (set at completion):

- `result.embedding_generated`: Boolean
- `result.is_safe`: Boolean
- `result.tags_count`: Number
- `result.tags`: Comma-separated tag list

---

## Child Spans

### 1. Embedding Generation Span

**Name**: `processEmbedding` | **Operation**: `ai.embedding`

Handles vector embedding generation for semantic search.

#### Attributes:

```typescript
{
  'post.id': postId,
  'content.length': content.length,
  'title.length': title.length,
}
```

#### Nested Child Span - API Call:

**Name**: `generateAndSaveEmbedding` | **Operation**: `ai.api.call`

```typescript
{
  'post.id': postId,
  'service': 'ai-embedding-service',
}
```

#### Result Attributes:

```typescript
{
  'result.success': true,
  'result.dimension': 768, // or actual dimension count
}
```

#### Error Handling:

- Captures exceptions with recoverable flag
- Errors are non-blocking (other tasks continue)
- Returns `null` on failure

---

### 2. Safety Check Span

**Name**: `processSafety` | **Operation**: `ai.safety_check`

Validates content against safety policies using Gemini AI.

#### Attributes:

```typescript
{
  'post.id': postId,
  'user.id': authorId,
  'content.length': content.length,
}
```

#### Nested Child Spans:

##### A. Gemini Safety Check API

**Name**: `checkSafety` | **Operation**: `ai.api.call`

```typescript
{
  'post.id': postId,
  'service': 'gemini',
  'operation': 'safety_check',
}
```

**Span Status Setting**:

- ✅ `ok` - Content is safe
- ❌ `error` - API call failed (message: error message)

##### B. Archive Unsafe Post

**Name**: `archiveUnsafePost` | **Operation**: `db.write`

Triggered only if content is unsafe.

```typescript
{
  'post.id': postId,
  'database.operation': 'update',
  'table': 'posts',
}
```

##### C. Notify Admins

**Name**: `notifyAdmins` | **Operation**: `db.write`

Creates notifications for all admin users.

```typescript
{
  'post.id': postId,
  'user.id': authorId,
  'notification.type': 'safety_violation',
}
```

###### Nested: Fetch Admin Users

**Name**: `fetchAdminUsers` | **Operation**: `db.read`

```typescript
{
  'query': 'find_admins',
}
```

**Result Attribute**: `admins.count` - Number of admins notified

#### Safety Span Status:

- ✅ `ok` - Safety check completed (safe or unsafe, both handled)
- ❌ `error` - Safety check operation failed

#### Error Handling:

- Errors are logged but non-blocking
- Default safety decision: "safe" (doesn't block post)
- Recoverable errors flag is set

---

### 3. Tagging Span

**Name**: `processTagging` | **Operation**: `ai.tagging`

Auto-generates and applies tags based on AI suggestions.

#### Attributes:

```typescript
{
  'post.id': postId,
  'content.length': content.length,
}
```

#### Result Attributes:

```typescript
{
  'result.suggested_tags_count': number,
  'result.suggested_tags': 'tag1,tag2,tag3',
  'result.tags_attached': number,
}
```

#### Nested Child Spans:

##### A. Fetch Existing Tags

**Name**: `fetchExistingTags` | **Operation**: `db.read`

```typescript
{
  'post.id': postId,
  'query': 'find_all_tags',
}
```

##### B. Gemini Tag Suggestions

**Name**: `suggestTags` | **Operation**: `ai.api.call`

```typescript
{
  'post.id': postId,
  'service': 'gemini',
  'operation': 'tag_suggestion',
  'existing_tags_count': number,
}
```

**Span Status Setting**:

- ✅ `ok` - Suggestions retrieved
- ❌ `error` - API call failed with error message

##### C. Create/Upsert Tags

**Name**: `createOrUpsertTags` | **Operation**: `db.write`

```typescript
{
  'post.id': postId,
  'tags.count': number,
  'database.operation': 'upsert',
  'table': 'tags',
}
```

##### D. Fetch Post with Existing Tags

**Name**: `fetchPostWithTags` | **Operation**: `db.read`

```typescript
{
  'post.id': postId,
  'query': 'find_unique_with_relations',
}
```

##### E. Attach Tags to Post

**Name**: `attachTagsToPost` | **Operation**: `db.write`

```typescript
{
  'post.id': postId,
  'tags.to_attach': number,
  'database.operation': 'create',
  'table': 'posts_tags',
}
```

**Result Attributes**:

- `tags.attached`: Count of newly attached tags
- `tags.skipped`: Count of duplicate tags skipped

**Span Status**:

- ✅ `ok` - Tags attached successfully
- ❌ `error` - Tag attachment failed

#### Error Handling:

- Errors are non-blocking (tagging failure doesn't block post)
- Recoverable errors flag is set
- Returns empty array on failure

---

## Exception Handling & Span Linking

### Exception Capture with Span Context

Every exception is captured with rich context before the span closes:

```typescript
Sentry.captureException(error, {
  tags: {
    task: 'operation_name',
    postId: postId.toString(),
    authorId?: authorId.toString(),
  },
  attributes: {
    'post.id': postId,
    'user.id': authorId,
    'error.phase': 'operation_phase',
    'error.recoverable': true/false,
  },
});
```

### Span Status Setting on Error

All child spans explicitly set error status before throwing/returning:

```typescript
span?.setStatus({
  code: 'error',
  message: error.message,
});
```

### Automatic Span Context Linking

When `Sentry.captureException()` is called within an active span:

1. The exception is automatically linked to the active span
2. The span's context (attributes, tags) is preserved
3. The exception appears in Sentry with full span trace

---

## Attributes Reference

### Common Attributes Across All Spans

| Attribute           | Type    | Example                | Usage                                 |
| ------------------- | ------- | ---------------------- | ------------------------------------- |
| `post.id`           | number  | `12345`                | Post identifier                       |
| `user.id`           | number  | `789`                  | Author/User ID                        |
| `content.length`    | number  | `1500`                 | Content size in bytes                 |
| `error.phase`       | string  | `embedding_generation` | Processing phase where error occurred |
| `error.recoverable` | boolean | `true`                 | Whether error is recoverable          |

### Operation-Specific Attributes

#### API Calls (`ai.api.call`, `ai.embedding`)

- `service`: API service name (e.g., `gemini`, `ai-embedding-service`)
- `operation`: Operation type (e.g., `safety_check`, `tag_suggestion`)

#### Database Operations (`db.read`, `db.write`)

- `database.operation`: Operation type (`read`, `write`, `upsert`, `create`, `update`)
- `table`: Database table name
- `query`: Query type (e.g., `find_admins`, `find_all_tags`)

#### Queue Operations

- `queue.job.id`: BullMQ job ID
- `queue.name`: Queue name
- `queue.processor`: Processor function name

---

## Observability Benefits

### 1. **Full Transaction Tracing**

- Root span provides top-level transaction view
- Child spans break down latency by operation type
- Automatic trace propagation through service calls

### 2. **Rich Context for Debugging**

- Attributes capture business logic context (post.id, user.id)
- Operation types help identify bottlenecks
- Error phases indicate where failures occur

### 3. **Error Correlation**

- Exceptions automatically linked to active spans
- Error context preserved across service boundaries
- Recoverable errors distinguished from critical failures

### 4. **Performance Monitoring**

- Database operation duration tracked separately
- API call latency isolated from business logic
- Parallel task execution visibility (embedding, safety, tagging)

### 5. **Threshold-Based Alerts**

- Set alerts on error rates per operation type
- Monitor API response times for degradation
- Track database query performance trends

---

## Usage in Sentry Dashboard

### View Traces

1. Navigate to **Sentry Dashboard** → **Traces**
2. Filter by operation type: `queue.process`, `ai.api.call`, `db.write`
3. Search by attributes: `post.id`, `user.id`, `error.phase`

### Example Queries

```
transaction:processPublishedPost
operation:ai.api.call
attribute:error.phase:embedding_generation
```

### Performance Analysis

- Compare average duration of each child span
- Identify which operation typically takes longest
- Detect anomalies in API response times

### Error Investigation

1. Click on error trace
2. View span timeline with all operations
3. Inspect attributes at each span for context
4. Follow links to source code

---

## Implementation Checklist

✅ Root Span initialization with Sentry.startSpan  
✅ Rich attributes on all spans (post.id, user.id, operation types)  
✅ Child spans for all high-latency operations  
✅ Nested child spans for database and API calls  
✅ Exception capture linked to active spans  
✅ Explicit span status setting on errors  
✅ Non-blocking error handling with error.recoverable flag  
✅ Result attributes captured at span completion  
✅ Comprehensive error context (phase, recoverable flag)  
✅ Parallel task execution support

---

## Code Examples

### Accessing Span in Error Context

```typescript
try {
  await someAsyncOperation();
} catch (error) {
  // Exception will be linked to the current active span
  Sentry.captureException(error, {
    attributes: {
      'error.phase': 'operation_name',
    },
  });
}
```

### Adding Custom Attributes During Execution

```typescript
const activeSpan = Sentry.getActiveSpan();
activeSpan?.setAttributes({
  'custom.metric': value,
});
```

### Manually Setting Span Status

```typescript
span?.setStatus({ code: 'ok' }); // Success
span?.setStatus({ code: 'error', message: 'Operation failed' }); // Error
```

---

## Sentry Configuration Requirements

Ensure Sentry is initialized with OpenTelemetry support:

```typescript
import * as Sentry from '@sentry/nestjs';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  integrations: [
    nodeProfilingIntegration(),
    // ... other integrations
  ],
  tracesSampleRate: 1.0,
  profilesSampleRate: 1.0,
});
```

---

## Related Files

- [src/queues/processors/ai-post-processor.worker.ts](../../src/queues/processors/ai-post-processor.worker.ts)
- [Sentry v8 Documentation](https://docs.sentry.io/platforms/javascript/enriching-events/attributes/)
- [OpenTelemetry Specification](https://opentelemetry.io/docs/)
