# Sentry v8+ Integration Examples

## Using the Instrumented AI Post Processor

### Table of Contents

1. [Viewing Traces in Sentry UI](#viewing-traces-in-sentry-ui)
2. [Setting Up Alerts](#setting-up-alerts)
3. [Custom Span Usage Patterns](#custom-span-usage-patterns)
4. [Performance Analysis](#performance-analysis)
5. [Error Investigation](#error-investigation)

---

## Viewing Traces in Sentry UI

### Accessing Your Traces

**Step 1**: Open Sentry Dashboard → Click "Traces" tab

**Step 2**: Search for the transaction

```
transaction:processPublishedPost
```

**Step 3**: View the trace timeline

```
Timeline View:
┌─ processPublishedPost (root) [5000ms]
├─ processEmbedding [1200ms]
│  └─ generateAndSaveEmbedding [1100ms] ✓ (api call)
├─ processSafety [2100ms]
│  ├─ checkSafety [800ms] ✓ (api call)
│  ├─ archiveUnsafePost [500ms] ✓ (db.write)
│  └─ notifyAdmins [800ms] ✓ (db.write)
│     └─ fetchAdminUsers [200ms] ✓ (db.read)
└─ processTagging [1700ms]
   ├─ fetchExistingTags [50ms] ✓ (db.read)
   ├─ suggestTags [900ms] ✓ (api call)
   ├─ createOrUpsertTags [400ms] ✓ (db.write)
   ├─ fetchPostWithTags [200ms] ✓ (db.read)
   └─ attachTagsToPost [150ms] ✓ (db.write)
```

### Inspecting Span Details

Click on any span in the timeline to view:

- **Operation Name**: `processEmbedding`
- **Operation Type**: `ai.embedding`
- **Status**: ✓ Ok
- **Duration**: 1200ms
- **Attributes**:
  ```
  post.id: 12345
  content.length: 1524
  title.length: 85
  result.success: true
  result.dimension: 768
  ```

---

## Setting Up Alerts

### Alert Type 1: Performance Degradation

**Create Alert**:

1. Sentry → Project Settings → Alerts → Create Alert Rule
2. **When**: Performance issue occurs
3. **Conditions**:
   ```
   transaction.duration > 30000ms
   transaction: processPublishedPost
   ```
4. **Notify**: Your team Slack channel

**Use Case**: Catch slow processing before it affects users

---

### Alert Type 2: Error Rate Spike

**Create Alert**:

1. Sentry → Project Settings → Alerts → Create Alert Rule
2. **When**: Error rate increases
3. **Conditions**:
   ```
   error.rate > 0.05
   operation: ai.api.call
   ```
4. **Notify**: #ai-team Slack channel

**Use Case**: Detect Gemini API failures

---

### Alert Type 3: Specific Operation Failure

**Create Alert**:

1. Sentry → Project Settings → Alerts → Create Alert Rule
2. **When**: Issues occur
3. **Conditions**:
   ```
   attribute: error.phase = embedding_generation
   level: error
   ```
4. **Threshold**: > 3 errors in 10 minutes

**Use Case**: Track embedding service issues

---

## Custom Span Usage Patterns

### Pattern 1: Access Active Span in Service Methods

```typescript
// In any service method called during trace
import * as Sentry from '@sentry/nestjs';

async myServiceMethod(postId: number) {
  const span = Sentry.getActiveSpan();

  // Add custom attributes
  span?.setAttributes({
    'custom.operation': 'special_processing',
    'custom.postId': postId,
  });

  // Do work...
}
```

### Pattern 2: Nested Span for Sub-Operation

```typescript
// Create explicit nested span for sub-operation
private async complexOperation(data: any) {
  return Sentry.startSpan(
    {
      name: 'complexSubOperation',
      op: 'custom.operation',
      attributes: { 'data.size': data.length },
    },
    async (span) => {
      try {
        const result = await this.doComplexWork(data);
        span?.setAttributes({ 'result.success': true });
        span?.setStatus({ code: 0 as any }); // Ok
        return result;
      } catch (error) {
        span?.setStatus({ code: 2 as any }); // Error
        throw error;
      }
    },
  );
}
```

### Pattern 3: Manual Exception Capture with Context

```typescript
// Capture exception with full span context
try {
  await riskyOperation();
} catch (error) {
  const span = Sentry.getActiveSpan();

  Sentry.captureException(error, {
    attributes: {
      'post.id': postId,
      'error.phase': 'risky_operation',
      'error.recoverable': false,
      'retry.attempted': false,
    },
    tags: {
      operation: 'risky_operation',
      severity: 'high',
    },
  });

  span?.setStatus({
    code: 2 as any,
    message: `Risky operation failed: ${error.message}`,
  });
}
```

---

## Performance Analysis

### Identifying Bottlenecks

**Scenario**: Your processPublishedPost is taking 30+ seconds

**Investigation Steps**:

1. **View Timeline in Sentry**
   - Look for the longest child span
   - Example: `generateAndSaveEmbedding` taking 15 seconds

2. **Check Operation Type**
   - Embedding (ai.api.call) → Gemini API is slow
   - Database (db.write) → Query optimization needed

3. **Review Attributes**
   - `content.length: 50000` → Very large content
   - Check if duration scales linearly

4. **Compare Against Baseline**
   ```
   Baseline: 1.5 seconds
   Current: 15 seconds
   Regression: 10x slower
   ```

### Creating Performance Dashboard

**Widget 1: Operation Duration by Type**

```
Query: processPublishedPost
Group by: operation
Chart: Average duration
```

**Widget 2: P95 Latency Trend**

```
Query: processPublishedPost
Metric: p95(duration)
Time Range: Last 7 days
```

**Widget 3: Error Rate by Phase**

```
Query: processPublishedPost AND error.*
Group by: attribute:error.phase
Chart: Count
```

---

## Error Investigation

### Scenario 1: Safety Check Fails

**Symptoms**: User complains post was archived incorrectly

**Investigation**:

1. **Find the trace**:

   ```
   Search: error.phase:safety_check
   Filter by: post.id = 12345
   ```

2. **Inspect the trace**:
   - Check `checkSafety` span status: ❌ Error
   - View error message in span attributes
   - Check Gemini API error details

3. **Root cause analysis**:

   ```
   checkSafety span attributes:
   - service: gemini
   - operation: safety_check
   - error.message: "Rate limit exceeded"
   - timestamp: 2026-01-21T10:15:30Z
   ```

4. **Resolution**:
   - Implement exponential backoff retry
   - Create alert for Gemini rate limiting
   - Update error.recoverable flag

---

### Scenario 2: Embedding Generation Times Out

**Symptoms**: Some posts never get embeddings

**Investigation**:

1. **Find timeout traces**:

   ```
   Search: operation:ai.embedding AND duration:>30000
   ```

2. **Pattern analysis**:
   - Check if large content correlates with timeouts
   - Example: content.length > 10000 always times out

3. **Check attributes**:

   ```
   processEmbedding span:
   - result.success: false
   - error.recoverable: true (task continues)
   - error.phase: embedding_generation
   ```

4. **Resolution options**:
   - Increase timeout threshold
   - Implement chunking for large content
   - Use background retry job

---

### Scenario 3: Database Deadlock on Tag Attachment

**Symptoms**: Tag attachment occasionally fails

**Investigation**:

1. **Find deadlock errors**:

   ```
   Search: operation:db.write AND
           attribute:error.phase:attachTagsToPost AND
           error.message:*deadlock*
   ```

2. **Analyze timing**:
   - When do deadlocks occur? (High concurrency hours?)
   - Duration of failed span vs. successful ones
   - Check transaction isolation level

3. **Examine attributes**:

   ```
   attachTagsToPost span:
   - database.operation: create
   - table: posts_tags
   - tags.to_attach: 5
   - error.message: "Deadlock detected"
   ```

4. **Resolution**:
   - Implement retry with exponential backoff
   - Add transaction timeout handling
   - Consider queue batching

---

## Advanced: Custom Metrics

### Metric 1: Embedding Quality Score

```typescript
// In processEmbedding span callback
span?.setAttributes({
  'embedding.dimensions': 768,
  'embedding.quality_score': 0.95,
  'embedding.computation_method': 'ada-002',
});
```

### Metric 2: Safety Check Confidence

```typescript
// In checkSafety span callback
span?.setAttributes({
  'safety.confidence_score': 0.98,
  'safety.violation_types': 'violence,hate_speech',
  'safety.model_version': 'v2.1',
});
```

### Metric 3: Tagging Relevance

```typescript
// In processTagging span callback
taggingSpan?.setAttributes({
  'tagging.suggestion_count': 8,
  'tagging.applied_count': 5,
  'tagging.relevance_score': 0.92,
  'tagging.most_confident': 'technology',
});
```

---

## Sentry Query Examples

### Query 1: Find Unsafe Posts

```
transaction:processPublishedPost AND
attribute:error.phase:safety_check AND
attribute:result.is_safe:false
```

### Query 2: Long Embedding Operations

```
transaction:processPublishedPost AND
operation:ai.embedding AND
duration:>5000
```

### Query 3: Failed Admin Notifications

```
transaction:processPublishedPost AND
operation:db.write AND
attribute:table:notifications AND
status:error
```

### Query 4: Gemini API Rate Limits

```
transaction:processPublishedPost AND
service:gemini AND
error.message:*rate*
```

### Query 5: Recoverable Errors

```
transaction:processPublishedPost AND
attribute:error.recoverable:true
```

---

## Best Practices

### ✅ DO

- Include post.id and user.id in every relevant span
- Set explicit span status (ok/error) before closing
- Use descriptive operation names (`checkSafety` vs. `op1`)
- Capture error context before exception propagates
- Use recoverable flag to distinguish blocking vs. non-blocking errors

### ❌ DON'T

- Don't leave span status unset (defaults to "Unset")
- Don't capture same exception multiple times in different spans
- Don't use generic operation names like "process" or "handle"
- Don't omit post.id from attributes (needed for correlation)
- Don't mix recoverable and non-recoverable error handling inconsistently

---

## Resources

- [ai-post-processor.worker.ts](../../src/queues/processors/ai-post-processor.worker.ts) - Implementation
- [SENTRY_V8_OTEL_IMPLEMENTATION.md](./SENTRY_V8_OTEL_IMPLEMENTATION.md) - Full documentation
- [SENTRY_V8_QUICK_REFERENCE.md](./SENTRY_V8_QUICK_REFERENCE.md) - Quick reference
- [Sentry Docs](https://docs.sentry.io/platforms/javascript/performance/)
- [OpenTelemetry Docs](https://opentelemetry.io/docs/)
