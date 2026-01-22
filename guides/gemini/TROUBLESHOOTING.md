# 🛠️ Troubleshooting & Setup Guide

## Issues & Solutions

### Issue 1: Sentry `startTransaction` Not Found

**Problem**: `Sentry.startTransaction()` doesn't exist in Sentry NestJS package

**Solution**: Use `@sentry/core` instead or remove transaction wrapping for compatibility

**Fix**:

```typescript
// Option A: Remove transactions (simpler, still get error tracking)
try {
  // code
  Sentry.captureMessage('...', 'info');
} catch (error) {
  Sentry.captureException(error);
}

// Option B: Use Sentry hub directly
const hub = Sentry.getCurrentHub();
const transaction = hub.startTransaction({...});
```

Recommendation: **Use Option A** for compatibility with existing Sentry setup.

---

### Issue 2: RedisService Missing `setex` Method

**Problem**: `redisService.setex()` doesn't exist

**Solution**: Use `set()` with `EX` option:

```typescript
// BEFORE (incorrect)
await this.redisService.setex(cacheKey, 86400, JSON.stringify(embedding));

// AFTER (correct)
await this.redisService.set(cacheKey, JSON.stringify(embedding), 'EX', 86400);
```

Find & Replace in:

- `src/ai/services/ai-embedding.service.ts` (line 55, 388)
- `src/ai/services/ai-agent.service.ts` (line 388, 444)

---

### Issue 3: Gemini SDK API Changes

**Problem**: `embedContent()` signature changed, stream API different

**Solution**: Update embedContent call:

```typescript
// BEFORE (wrong)
this.embeddingModel.embedContent({
  content: { parts: [{ text: truncatedText }] },
})

// AFTER (correct)
this.embeddingModel.embedContent({
  content: truncatedText,
})

// For streaming:
const stream = await this.chatModel.generateContentStream({...});
for await (const chunk of stream) {
  const text = chunk.text?.();
}
```

---

### Issue 4: Missing Type Imports

**Problem**: `Job` type needs `import type` for decorators

**Solution**: Use type imports:

```typescript
// BEFORE
import { Job } from 'bull';

// AFTER
import type { Job } from 'bull';
```

---

### Issue 5: JwtGuard Import Path

**Problem**: Import path not found for `JwtGuard`

**Solution**: Find correct path in your project:

```bash
find src -name "*jwt*" -type f  # Search for jwt files
find src -name "*guard*" -type f
```

Then update imports accordingly.

---

## Quick Fix Commands

Run these to fix all issues automatically:

```bash
# 1. Update setex to set with EX
sed -i 's/setex(\(.*\), \([0-9]*\), /set(\1, /g' src/ai/services/*.ts
sed -i "s/, JSON.stringify/, 'EX', <TTL>, JSON.stringify/g" src/ai/services/*.ts

# 2. Fix embedContent call
sed -i 's/embedContent({[[:space:]]*content: { parts: \[{ text: \(.*\) \}/) }\]/embedContent({\n        content: \1\n      })/g' src/ai/services/gemini.service.ts

# 3. Update type imports
sed -i 's/^import { Job }/import type { Job }/g' src/**/*.ts
```

---

## Manual Setup (Recommended)

### Step 1: Check Your Environment

```bash
# Verify current setup
grep -r "RedisService" src --include="*.ts" | head -5
grep -r "JwtGuard" src --include="*.ts" | head -5
grep -r "Sentry" src --include="*.ts" | head -5
```

### Step 2: Update Sentry Usage

Remove all `Sentry.startTransaction()` calls. Replace with:

```typescript
// Use @Sentry/core utilities
import { captureException, captureMessage } from '@sentry/nestjs';

try {
  // your code
  captureMessage('Operation completed', 'info');
} catch (error) {
  captureException(error, {
    tags: { operation: 'my_operation' },
  });
  throw error;
}
```

### Step 3: Update Redis Calls

Search for `setex(` and replace:

```typescript
// Pattern: this.redisService.setex(key, ttl, value)
// Replace with: this.redisService.set(key, value, 'EX', ttl)

// Example:
await this.redisService.set(
  `embedding:post:${postId}`,
  JSON.stringify(embedding),
  'EX',
  this.embeddingCacheTTL,
);
```

### Step 4: Fix Gemini SDK Calls

Update embedContent and streaming:

```typescript
// embedContent - use string directly
const response = await this.embeddingModel.embedContent(truncatedText);

// Streaming - correct iteration
const stream = await this.chatModel.generateContentStream({...});
for await (const chunk of stream) {
  const text = chunk.text?.();
  if (text) yield text;
}
```

### Step 5: Fix Type Imports

```typescript
// Top of file
import type { Job } from 'bull';
import type { GenerativeModel } from '@google/generative-ai';
```

---

## Verification Checklist

After applying fixes:

```bash
# 1. Type check
npm run typecheck

# 2. Lint
npm run lint

# 3. Build
npm run build

# 4. Start dev server
npm run start:dev

# 5. Test API
curl -X POST http://localhost:3000/ai/chat \
  -H "Authorization: Bearer YOUR_JWT" \
  -d '{"message":"test"}'
```

Expected output: No TypeScript errors, API responds with AI response

---

## Code Compatibility Matrix

| Feature                 | Status           | Solution                              |
| ----------------------- | ---------------- | ------------------------------------- |
| Sentry startTransaction | ❌ Not available | Use captureMessage/captureException   |
| RedisService.setex      | ❌ Not available | Use .set() with 'EX' option           |
| Gemini embedContent     | ⚠️ API changed   | Pass string directly                  |
| Stream iteration        | ⚠️ API changed   | Await stream first                    |
| JwtGuard import         | ❌ Wrong path    | Find correct path in src              |
| Type imports            | ⚠️ Required      | Use `import type` for decorator types |

---

## Production Deployment

Once all fixes applied:

```bash
# 1. Build production bundle
npm run build

# 2. Test bundle locally
npm run start:prod

# 3. Monitor startup logs
# Should see:
# - GeminiService initialized with models
# - QueueModule registered with aiProcessor queue
# - All services connected

# 4. Deploy
# git push (CI/CD will handle build/deploy)
```

---

## Rollback Plan

If issues occur in production:

```bash
# 1. Stop current deployment
docker stop <container>

# 2. Revert code
git revert <commit-hash>

# 3. Rebuild and restart
npm run build && npm start
```

---

## Support

If you encounter errors:

1. **Check logs first**:

   ```bash
   npm run start:dev 2>&1 | head -50
   ```

2. **Verify imports**:

   ```bash
   grep -n "import.*from" src/ai/services/gemini.service.ts | head -20
   ```

3. **Check versions**:

   ```bash
   npm list @sentry/nestjs @google/generative-ai ioredis
   ```

4. **Try type checking**:
   ```bash
   npx tsc --noEmit
   ```

---

## Performance Testing After Fixes

Run these to verify optimizations are working:

```bash
# Test query latency
curl -w "@curl-format.txt" -o /dev/null -s \
  -X POST http://localhost:3000/ai/chat \
  -H "Authorization: Bearer JWT" \
  -d '{"message":"How do I use TypeScript?"}'

# Expected: <3s total response time

# Monitor Redis
redis-cli MONITOR | grep "embedding"

# Check active connections
redis-cli KEYS "chat:*:*" | wc -l
```

---

See [PERFORMANCE_FIXES.md](PERFORMANCE_FIXES.md) for optimization details.
