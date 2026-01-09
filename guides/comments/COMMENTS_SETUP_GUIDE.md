# Comments Module - Setup & Deployment Guide

## Quick Setup (5 minutes)

### Step 1: Regenerate Prisma Client

```bash
# This will include the new deleted_at field in the comments model
npx prisma generate
```

### Step 2: Run Database Migration

```bash
# Apply the soft delete column to your database
npx prisma migrate deploy
```

### Step 3: Start the Server

```bash
# Development mode
npm run start:dev

# Or production mode
npm run start:prod
```

### Step 4: Verify Installation

```bash
# Test the endpoint (no auth required)
curl http://localhost:3000/posts/1/comments

# Should return:
# {"data": [], "total": 0}
```

## Full Installation Checklist

- [ ] **Prisma Update**: `npx prisma generate`
- [ ] **Database Migration**: `npx prisma migrate deploy`
- [ ] **Server Restart**: Stop and restart the server
- [ ] **Endpoint Test**: Test GET /posts/:id/comments
- [ ] **Create Test**: Create a comment via POST with JWT
- [ ] **Verify Cache**: Check Redis has `comments:post:X` keys
- [ ] **Test Authorization**: Try unauthorized delete/update

## Troubleshooting

### Issue: "deleted_at does not exist in type 'commentsSelect'"

**Solution**: Regenerate Prisma client

```bash
npx prisma generate
```

### Issue: Comment creation fails with "column deleted_at does not exist"

**Solution**: Apply migrations

```bash
npx prisma migrate deploy
```

### Issue: Cache not working (always rebuilds tree)

**Solution**: Verify Redis is running

```bash
# Check Redis connection
redis-cli ping
# Should return: PONG

# Or test via service
curl http://localhost:3000/health  # If health endpoint exists
```

### Issue: Rate limiting not working

**Solution**: Verify Throttler is configured in main.ts

```typescript
// src/main.ts should have ThrottlerGuard configured
app.useGlobalGuards(new ThrottlerGuard());
```

### Issue: Authorization guard always denies access

**Solution**: Ensure JWT token has correct claims

```typescript
// JWT payload should have:
{
  sub: 1,        // user ID
  email: "...",
  role: "USER",  // or "ADMIN"
  version: 1
}
```

## File Location Reference

```
d:\saves\Fullstack\Project\dev-share-lite-be\
├── src\comments\                          ← NEW MODULE
│   ├── comments.controller.ts            ← REST endpoints
│   ├── comments.service.ts               ← Business logic
│   ├── comments.module.ts                ← Module export
│   ├── dto\
│   │   ├── create-comment.dto.ts        ← Request validation
│   │   └── comment-response.dto.ts      ← Response types
│   ├── guards\
│   │   └── comment-ownership.guard.ts   ← Authorization
│   └── utils\
│       └── comment-tree.utility.ts      ← Tree algorithm
│
├── prisma\
│   ├── schema.prisma                    ← Updated (added deleted_at)
│   └── migrations\
│       └── .../migration.sql            ← Database changes
│
├── src\app.module.ts                    ← Updated (added CommentsModule)
├── COMMENTS_MODULE_GUIDE.md             ← Comprehensive guide
├── COMMENTS_IMPLEMENTATION_SUMMARY.md   ← Summary
└── COMMENTS_SETUP_GUIDE.md              ← This file
```

## Environment Requirements

- **Node.js**: 18+ (for native Promise support)
- **PostgreSQL**: 12+ (for JSON, soft delete support)
- **Redis**: 6+ (for caching)
- **NestJS**: 11+
- **Prisma**: 7.2+

## Configuration

### Redis Configuration

Comments service uses existing Redis setup from RedisModule:

```typescript
// Already configured in redis.module.ts
@Module({
  imports: [
    RedisModule.forRoot({
      type: 'single',
      url: process.env.REDIS_URL,
    }),
  ],
})
export class RedisModule {}
```

No additional configuration needed!

### Throttler Configuration

Comments use `@Throttle()` decorators:

```typescript
@Throttle({ default: { limit: 5, ttl: 300 } }) // 5 per 5 min
```

Ensure `ThrottlerGuard` is registered globally:

```typescript
// main.ts
import { ThrottlerGuard } from '@nestjs/throttler';

app.useGlobalGuards(new ThrottlerGuard());
```

## Database Schema Changes

### Before (Existing)

```sql
CREATE TABLE comments (
  id SERIAL PRIMARY KEY,
  content TEXT NOT NULL,
  post_id INT NOT NULL,
  author_id INT NOT NULL,
  parent_id INT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (post_id) REFERENCES posts(id),
  FOREIGN KEY (author_id) REFERENCES users(id),
  FOREIGN KEY (parent_id) REFERENCES comments(id)
);
```

### After (With Soft Delete)

```sql
ALTER TABLE comments ADD COLUMN deleted_at TIMESTAMP NULL;
CREATE INDEX comments_deleted_at_idx ON comments(deleted_at);
```

**Migration File**: `prisma/migrations/20260109000000_add_soft_delete_comments/migration.sql`

## Testing Checklist

### Prerequisites

1. Get a valid JWT token from login:

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "Password123"
  }'

# Response:
# {
#   "access_token": "eyJhbGciOiJIUzI1NiIs...",
#   "refresh_token": "..."
# }
```

2. Create a post first:

```bash
curl -X POST http://localhost:3000/posts \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Post",
    "content_markdown": "This is a test post with enough content.",
    "is_published": true,
    "tags": ["testing"]
  }'

# Note: postId from response
```

### Test 1: Create Root Comment

```bash
curl -X POST http://localhost:3000/posts/1/comments \
  -H "Authorization: Bearer <YOUR_JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "This is a great post!",
    "postId": 1
  }'

# Expected: 201 Created
# Response includes comment with id, authorId, createdAt, etc.
```

### Test 2: Create Reply (Nested)

```bash
curl -X POST http://localhost:3000/posts/1/comments \
  -H "Authorization: Bearer <YOUR_JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "I agree with this!",
    "postId": 1,
    "parentId": 1
  }'

# Expected: 201 Created
# parentId should match the root comment ID from Test 1
```

### Test 3: Get Comments Tree

```bash
curl http://localhost:3000/posts/1/comments

# Expected: 200 OK
# Response shows hierarchical structure:
# {
#   "data": [
#     {
#       "id": 1,
#       "content": "This is a great post!",
#       "replies": [
#         {
#           "id": 2,
#           "content": "I agree with this!",
#           "replies": []
#         }
#       ]
#     }
#   ],
#   "total": 2
# }
```

### Test 4: Get Single Comment

```bash
curl http://localhost:3000/comments/1

# Expected: 200 OK
# Response is comment without nested replies array
```

### Test 5: Update Comment (With Auth)

```bash
curl -X PATCH http://localhost:3000/comments/1 \
  -H "Authorization: Bearer <YOUR_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"content": "Updated comment text"}'

# Expected: 200 OK
# Response shows updated comment with new content
```

### Test 6: Update As Non-Author (Should Fail)

```bash
# Use a different user's JWT token
curl -X PATCH http://localhost:3000/comments/1 \
  -H "Authorization: Bearer <DIFFERENT_USER_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"content": "Hacked!"}'

# Expected: 403 Forbidden
# Message: "Only the comment author or admin can update this comment"
```

### Test 7: Delete Comment (Soft Delete)

```bash
curl -X DELETE http://localhost:3000/comments/1 \
  -H "Authorization: Bearer <YOUR_JWT>"

# Expected: 200 OK
# Response shows comment with:
# - content: "This comment has been removed"
# - isDeleted: true
```

### Test 8: Verify Child Preserved

```bash
curl http://localhost:3000/posts/1/comments

# Expected: 200 OK
# Shows:
# {
#   "data": [
#     {
#       "id": 1,
#       "content": "This comment has been removed",
#       "isDeleted": true,
#       "replies": [
#         {
#           "id": 2,
#           "content": "I agree with this!",
#           "isDeleted": false,
#           "replies": []
#         }
#       ]
#     }
#   ]
# }
```

### Test 9: Rate Limiting

```bash
# Make 6 requests rapidly
for i in {1..6}; do
  curl -X POST http://localhost:3000/posts/1/comments \
    -H "Authorization: Bearer <YOUR_JWT>" \
    -H "Content-Type: application/json" \
    -d '{"content": "Comment '$i'", "postId": 1}'
  sleep 0.1
done

# Expected: First 5 return 201, 6th returns 429 Too Many Requests
```

### Test 10: Cache Validation

```bash
# First request (cache miss)
time curl http://localhost:3000/posts/1/comments

# Should take ~50ms (DB + tree building)

# Second request (cache hit)
time curl http://localhost:3000/posts/1/comments

# Should take <5ms (Redis lookup)

# Make a change (invalidates cache)
curl -X POST http://localhost:3000/posts/1/comments \
  -H "Authorization: Bearer <YOUR_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"content": "New comment", "postId": 1}'

# Next request rebuilds cache (50ms again)
time curl http://localhost:3000/posts/1/comments
```

## Performance Monitoring

### Redis Cache Keys

```bash
# Connect to Redis
redis-cli

# View cache keys
KEYS "comments:post:*"
# Output: ["comments:post:1", "comments:post:2", ...]

# Check cache size
STRLEN comments:post:1
# Output: <size in bytes>

# Monitor cache hits
MONITOR
# Shows all Redis operations in real-time
```

### Database Queries

```bash
# Enable slow query log in PostgreSQL (optional)
SET log_min_duration_statement = 100;  -- Log queries > 100ms

# Check query performance
EXPLAIN ANALYZE
  SELECT * FROM comments
  WHERE post_id = 1
  ORDER BY created_at ASC;
```

## Production Deployment

### Environment Variables Required

```env
# .env
DATABASE_URL=postgresql://user:password@localhost:5432/devshare
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret-key
JWT_EXPIRY=15m
REFRESH_TOKEN_EXPIRY=7d
NODE_ENV=production
```

### Deployment Checklist

- [ ] Update `.env` with production values
- [ ] Run `npm run build`
- [ ] Run `npx prisma migrate deploy`
- [ ] Verify Redis is accessible
- [ ] Start with `npm run start:prod`
- [ ] Monitor logs for errors
- [ ] Test endpoints in production
- [ ] Monitor Redis memory usage
- [ ] Set up database backups

### Monitoring & Logging

```typescript
// Enable logging in CommentsService
private logger = new Logger('CommentsService');

// Log important operations
this.logger.log(`Comment ${id} created by user ${userId}`);
this.logger.error(`Cache invalidation failed for post ${postId}`);
```

## Rollback Plan

If issues arise:

```bash
# 1. Revert schema changes
npx prisma migrate resolve --rolled-back 20260109000000_add_soft_delete_comments

# 2. Remove CommentsModule from app.module.ts
# 3. Delete comments directory: rm -rf src/comments/
# 4. Restart server
npm run start:dev
```

## Support & Next Steps

### Documentation

- [Comprehensive Guide](./COMMENTS_MODULE_GUIDE.md)
- [Implementation Summary](./COMMENTS_IMPLEMENTATION_SUMMARY.md)

### Common Questions

- **Q: Can I recover deleted comments?**
  - A: Yes, update `deleted_at` to NULL in database

- **Q: How do I increase the rate limit?**
  - A: Change `@Throttle({ limit: 10, ttl: 300 })` in controller

- **Q: Can I disable soft delete?**
  - A: Yes, change `DELETE` to actual removal (not recommended)

- **Q: How do I monitor cache effectiveness?**
  - A: Use Redis Monitor: `redis-cli MONITOR`

---

**Status**: ✅ Ready to Deploy

**Questions?** Review the COMMENTS_MODULE_GUIDE.md for detailed feature documentation.
