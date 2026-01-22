# Sentry v8+ OpenTelemetry Implementation - Quick Reference

## AI Post Processor Worker

### Module Overview

✅ **Status**: Fully implemented with production-ready observability

The `ai-post-processor.worker.ts` now includes comprehensive Sentry v8+ OpenTelemetry instrumentation with:

- Root span for entire business logic flow
- Nested child spans for all high-latency operations
- Rich attributes on every span
- Automatic exception linking
- Explicit error status handling

---

## Span Hierarchy

```
ROOT: processPublishedPost [queue.process]
├── CHILD: processEmbedding [ai.embedding]
│   └── CHILD: generateAndSaveEmbedding [ai.api.call]
├── CHILD: processSafety [ai.safety_check]
│   ├── CHILD: checkSafety [ai.api.call]
│   ├── CHILD: archiveUnsafePost [db.write]
│   └── CHILD: notifyAdmins [db.write]
│       └── CHILD: fetchAdminUsers [db.read]
└── CHILD: processTagging [ai.tagging]
    ├── CHILD: fetchExistingTags [db.read]
    ├── CHILD: suggestTags [ai.api.call]
    ├── CHILD: createOrUpsertTags [db.write]
    ├── CHILD: fetchPostWithTags [db.read]
    └── CHILD: attachTagsToPost [db.write]
```

---

## Key Attributes

### Root Span Attributes

```typescript
'post.id': number          // Post identifier
'user.id': number          // Author user ID
'queue.job.id': string     // BullMQ job ID
'queue.name': string       // Queue name
'queue.processor': string  // Processor function name
```

### Common Child Span Attributes

```typescript
'post.id': number                    // Identifies the post being processed
'user.id': number                    // When applicable
'content.length': number             // Size of content
'database.operation': string         // 'read', 'write', 'upsert', 'create', 'update'
'table': string                      // Database table name
'service': string                    // 'gemini', 'ai-embedding-service', etc.
'operation': string                  // Specific operation type
'error.phase': string                // Where error occurred
'error.recoverable': boolean         // Whether error blocks processing
```

---

## Observability Features

### 1. **Latency Breakdown**

Each operation has its own span:

- Database queries tracked as `db.read` or `db.write`
- Gemini API calls tracked as `ai.api.call`
- Embedding service calls tracked as `ai.api.call`

View timeline in Sentry dashboard to identify bottlenecks.

### 2. **Exception Linking**

When an exception occurs:

```typescript
// Inside span context
try {
  await someOperation();
} catch (error) {
  // Exception automatically linked to active span
  Sentry.captureException(error, {
    attributes: {
      'error.phase': 'operation_name',
      'error.recoverable': true,
    },
  });
}
```

### 3. **Span Status Tracking**

All spans explicitly set status:

```typescript
// Success case
span?.setStatus({ code: 0 as any }); // 0 = Ok

// Error case
span?.setStatus({
  code: 2 as any, // 2 = Error
  message: error.message,
});
```

### 4. **Result Metrics**

Root span captures final results:

```typescript
{
  'result.embedding_generated': boolean
  'result.is_safe': boolean
  'result.tags_count': number
  'result.tags': string (comma-separated)
}
```

---

## Tracing Examples

### Example 1: View Full Trace in Sentry

1. Go to **Sentry Dashboard** → **Traces** tab
2. Search: `transaction:processPublishedPost`
3. Click on trace to view timeline:
   - Root span shows total duration
   - Each child span shows operation duration
   - Attributes visible in span details

### Example 2: Find Slow Database Operations

```
operation:db.write AND duration:>1000
transaction:processPublishedPost
```

### Example 3: Track Safety Check Failures

```
attribute:error.phase:safety_check
```

### Example 4: Monitor Gemini API Performance

```
operation:ai.api.call AND service:gemini
```

---

## Error Handling Strategy

### Recoverable Errors (Non-Blocking)

- **Embedding Generation**: Other tasks continue if embedding fails
- **Auto-Tagging**: Task continues if suggestions fail

```typescript
'error.recoverable': true  // Set for these operations
// Returns default/null value, doesn't throw
```

### Non-Recoverable Errors (Blocking)

- **Archive Post**: If update fails, exception propagates
- **Notify Admins**: If notification creation fails, exception propagates

```typescript
'error.recoverable': false  // Or omitted
// Exception thrown and caught at root level
```

---

## Sentry Dashboard Setup

### 1. Create Dashboard

```
Name: AI Post Processing
Description: Monitor post.published event processing
```

### 2. Add Widgets

- **Widget 1**: Average span duration by operation type
- **Widget 2**: Error rate by operation
- **Widget 3**: Gemini API latency percentiles
- **Widget 4**: Database operation duration distribution

### 3. Recommended Alerts

```
Alert 1: If processPublishedPost duration > 30 seconds
Alert 2: If Gemini API response time > 5 seconds
Alert 3: If database write operations > 2 seconds
Alert 4: If error rate > 5% for any operation type
```

---

## Implementation Validation Checklist

✅ Root span wraps entire processPublishedPost flow  
✅ Child spans created for: embedding, safety check, tagging  
✅ Nested spans for: API calls, database operations  
✅ Rich attributes on every span  
✅ Exception capture linked to spans  
✅ Explicit status setting (code: 0 for ok, code: 2 for error)  
✅ Error context includes phase and recoverable flag  
✅ Result metrics captured at root span completion  
✅ Non-blocking errors don't fail root span  
✅ All high-latency operations instrumented

---

## Attribute Reference Table

| Attribute                  | Type    | Example                | Used In                    |
| -------------------------- | ------- | ---------------------- | -------------------------- |
| post.id                    | number  | 12345                  | All spans                  |
| user.id                    | number  | 789                    | Safety, Tagging            |
| content.length             | number  | 1500                   | Embedding, Safety, Tagging |
| queue.job.id               | string  | "job_123"              | Root span                  |
| queue.name                 | string  | "aiProcessor"          | Root span                  |
| database.operation         | string  | "update"               | DB spans                   |
| table                      | string  | "posts"                | DB spans                   |
| service                    | string  | "gemini"               | API spans                  |
| operation                  | string  | "safety_check"         | API spans                  |
| error.phase                | string  | "embedding_generation" | Error contexts             |
| error.recoverable          | boolean | true                   | Error contexts             |
| result.embedding_generated | boolean | true                   | Root span                  |
| result.is_safe             | boolean | false                  | Root span                  |
| result.tags_count          | number  | 5                      | Root span                  |
| admins.count               | number  | 3                      | Notify span                |
| tags.attached              | number  | 2                      | Attach span                |

---

## Production Deployment Checklist

1. **Sentry Configuration**
   - [ ] DSN configured in environment
   - [ ] tracesSampleRate set appropriately (0.1-1.0)
   - [ ] Node profiling integration enabled

2. **Monitoring**
   - [ ] Dashboard created in Sentry
   - [ ] Alerts configured
   - [ ] Team notifications enabled

3. **Validation**
   - [ ] Test trace appears in Sentry within 5 minutes
   - [ ] All attributes visible in span details
   - [ ] Error spans show correct status
   - [ ] Timeline shows expected operation sequence

4. **Performance Baseline**
   - [ ] Document baseline durations for each operation
   - [ ] Set alert thresholds based on baseline
   - [ ] Monitor for regression in first week

---

## Troubleshooting

### Spans not appearing in Sentry

- [ ] Verify Sentry DSN configured correctly
- [ ] Check `tracesSampleRate` > 0
- [ ] Ensure code is in active span context
- [ ] Verify `Sentry.startSpan()` is called

### Attributes missing from spans

- [ ] Confirm `attributes` object passed to span config
- [ ] Use `span?.setAttributes()` for dynamic attributes
- [ ] Check attribute names don't contain spaces

### Exception not linked to span

- [ ] Ensure `Sentry.captureException()` called within span context
- [ ] Verify error thrown before span closes
- [ ] Check exception handler is within try block

### Status showing as "Unset"

- [ ] Verify `setStatus()` called before span closes
- [ ] Use correct codes: `0` (ok) or `2` (error)
- [ ] Ensure `as any` cast for numeric codes

---

## Related Documentation

- [Implementation Guide](./SENTRY_V8_OTEL_IMPLEMENTATION.md)
- [Sentry v8 API Reference](https://docs.sentry.io/platforms/javascript/performance/instrumentation/)
- [OpenTelemetry Specification](https://opentelemetry.io/docs/reference/specification/overview/)
