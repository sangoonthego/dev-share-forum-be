## Comments Module - Implementation Guide

### Overview

A high-performance, secure nested comment system for the DevShare Forum with:

- Hierarchical comment trees with parent-child relationships
- Advanced authorization (comment author, post author, admin)
- Redis caching for optimal performance
- Soft delete with placeholder content
- XSS prevention via DOMPurify sanitization
- Rate limiting (5 comments per 5 minutes per user)

### File Structure

```
src/comments/
├── comments.controller.ts       # REST endpoints
├── comments.service.ts          # Business logic & caching
├── comments.module.ts           # Module definition
├── dto/
│   ├── create-comment.dto.ts   # Request validation
│   └── comment-response.dto.ts # Response types
├── guards/
│   └── comment-ownership.guard.ts # Authorization logic
└── utils/
    └── comment-tree.utility.ts  # Flat-to-tree transformation
```

### API Endpoints

#### 1. Create Comment

```
POST /posts/:postId/comments
Headers: Authorization: Bearer <JWT>
Body:
{
  "content": "Great post!",
  "postId": 1,
  "parentId": 5  // Optional - for replies
}

Response: 201 Created
{
  "id": 10,
  "content": "Great post!",
  "postId": 1,
  "authorId": 3,
  "author": {
    "id": 3,
    "email": "user@example.com",
    "full_name": "John Doe",
    "profile_avatar": "https://..."
  },
  "parentId": 5,
  "isDeleted": false,
  "createdAt": "2026-01-09T10:30:00Z",
  "updatedAt": "2026-01-09T10:30:00Z",
  "replies": []
}
```

**Rate Limiting**: 5 comments per 5 minutes per user (returns 429 if exceeded)

#### 2. Get All Comments for Post (Hierarchical Tree)

```
GET /posts/:postId/comments

Response: 200 OK
{
  "data": [
    {
      "id": 1,
      "content": "First comment",
      "postId": 5,
      "authorId": 2,
      "author": {...},
      "parentId": null,
      "isDeleted": false,
      "createdAt": "2026-01-08T10:00:00Z",
      "updatedAt": "2026-01-08T10:00:00Z",
      "replies": [
        {
          "id": 3,
          "content": "Reply to first",
          "postId": 5,
          "authorId": 3,
          "author": {...},
          "parentId": 1,
          "isDeleted": false,
          "createdAt": "2026-01-08T11:00:00Z",
          "updatedAt": "2026-01-08T11:00:00Z",
          "replies": []
        }
      ]
    }
  ],
  "total": 15
}
```

**Caching**: Response cached in Redis for 1 hour. Invalidated when new comment created/updated/deleted.

#### 3. Get Single Comment

```
GET /comments/:id

Response: 200 OK
{
  "id": 5,
  "content": "Comment content",
  "postId": 1,
  "authorId": 2,
  "author": {...},
  "parentId": null,
  "isDeleted": false,
  "createdAt": "2026-01-08T10:00:00Z",
  "updatedAt": "2026-01-08T10:00:00Z",
  "replies": []
}
```

#### 4. Update Comment

```
PATCH /comments/:id
Headers: Authorization: Bearer <JWT>
Body:
{
  "content": "Updated comment text"
}

Response: 200 OK
{...updated comment...}

Errors:
- 403 Forbidden: Only comment author or admin can update
- 404 Not Found: Comment doesn't exist
- 409 Conflict: Cannot update deleted comment
```

**Authorization**: Only comment author or admin can update.

#### 5. Delete Comment (Soft Delete)

```
DELETE /comments/:id
Headers: Authorization: Bearer <JWT>

Response: 200 OK
{
  "id": 5,
  "content": "This comment has been removed",
  "isDeleted": true,
  ...
}

Errors:
- 403 Forbidden: Not authorized
- 404 Not Found: Comment doesn't exist
```

**Authorization**: Comment author, post author, or admin can delete.

### Advanced Features

#### 1. Hierarchical Comments with Soft Delete

When a parent comment is deleted:

```
POST /posts/1/comments
{
  "content": "Root comment",
  "postId": 1
}
→ Comment ID: 1

POST /posts/1/comments
{
  "content": "Reply to root",
  "postId": 1,
  "parentId": 1
}
→ Comment ID: 2

DELETE /comments/1
→ Comment 1 content becomes "This comment has been removed"
→ Comment 2 (reply) is still visible under deleted parent

GET /posts/1/comments
→ Shows:
  {
    "id": 1,
    "content": "This comment has been removed",
    "isDeleted": true,
    "replies": [
      {
        "id": 2,
        "content": "Reply to root",
        "isDeleted": false,
        "replies": []
      }
    ]
  }
```

**Why Soft Delete**:

- Preserves conversation context
- Prevents orphaned replies
- Allows potential restoration
- Maintains post integrity

#### 2. Authorization Logic

**UPDATE (PATCH)**:

- ✅ Comment author
- ✅ Admin
- ❌ Post author cannot update others' comments

**DELETE (DELETE)**:

- ✅ Comment author (can delete own)
- ✅ Post author (can moderate their post)
- ✅ Admin (can moderate any)
- ❌ Other users

```typescript
// In CommentOwnershipGuard
if (method === 'PATCH') {
  // Only author or admin
} else if (method === 'DELETE') {
  // Author OR post author OR admin
}
```

#### 3. Caching Strategy

**Cache Key Format**: `comments:post:{postId}`

**Cache Behavior**:

- First request: Query database, build tree, cache result (1 hour TTL)
- Subsequent requests: Serve from Redis (instant)
- Cache invalidation: Automatic on create/update/delete

**Performance Impact**:

- Large comment threads: 100+ comments → 1 query + O(n) tree building
- Without caching: Every request rebuilds tree
- With caching: Subsequent requests are instant

```typescript
// In CommentsService
const cacheKey = `comments:post:${postId}`;
const cachedTree = await this.redis.get(cacheKey);
if (cachedTree) return JSON.parse(cachedTree);

// Cache miss → query + cache result
const comments = await this.prisma.comments.findMany(...);
const tree = CommentTreeUtility.buildCommentTree(comments);
await this.redis.set(cacheKey, JSON.stringify(tree), 3600);
```

#### 4. XSS Prevention

All comment content is sanitized using `isomorphic-dompurify`:

```typescript
// In CommentsService.createComment
const sanitizedContent = DOMPurify.sanitize(dto.content);
```

**Prevents**:

- `<script>alert('XSS')</script>` → removed
- Event handlers: `onclick`, `onerror` → removed
- Dangerous attributes → removed
- Safe HTML tags: `<b>`, `<i>`, `<a>` → preserved

#### 5. Rate Limiting

```typescript
@Throttle({ default: { limit: 5, ttl: 300 } }) // 5 per 5 minutes
async createComment(...) { }
```

**When Exceeded**:

- Returns: 429 Too Many Requests
- Message: "ThrottlerException: Request limited to 5 requests in 300 seconds"
- Per-user basis (identified by JWT sub)

### Database Integration

#### Prisma Schema

```prisma
model comments {
  id        Int    @id @default(autoincrement())
  content   String

  post_id   Int
  post      posts @relation(fields: [post_id], references: [id])

  author_id Int
  author    users @relation(fields: [author_id], references: [id])

  parent_id Int?
  parent    comments? @relation("CommentReplies", fields: [parent_id], references: [id])
  replies   comments[] @relation("CommentReplies")

  deleted_at DateTime?  // Soft delete support

  created_at DateTime @default(now())
  updated_at DateTime @updatedAt

  @@map("comments")
}
```

#### Migration

```sql
ALTER TABLE "comments" ADD COLUMN "deleted_at" TIMESTAMP(3);
CREATE INDEX "comments_deleted_at_idx" ON "comments"("deleted_at");
```

**Migrate**:

```bash
npx prisma migrate deploy
npx prisma generate  # Update Prisma client
```

### Performance Considerations

1. **Single Database Query**
   - All comments fetched in one query (no N+1)
   - Author info included via JOIN
   - No nested loops in controller

2. **Tree Building Algorithm**
   - Time: O(n) where n = comment count
   - Space: O(n) for tree structure
   - Efficient even for 1000+ comments

3. **Caching**
   - Eliminates repeated tree building
   - Typical TTL: 1 hour
   - Auto-invalidation on mutations

4. **Soft Delete Index**
   - Index on `deleted_at` for filtering
   - Future: can optimize queries to exclude deleted comments

### Security Checklist

- ✅ XSS Prevention: DOMPurify sanitization
- ✅ Authentication: JWT via AtGuard
- ✅ Authorization: CommentOwnershipGuard
- ✅ Rate Limiting: 5 per 5 minutes
- ✅ SQL Injection: Prisma parameterized queries
- ✅ Soft Delete: Data preservation while enabling moderation
- ✅ Cache Invalidation: Automatic on mutations

### Error Handling

| Status | Scenario                                          |
| ------ | ------------------------------------------------- |
| 201    | Comment created successfully                      |
| 200    | Comment retrieved/updated/deleted                 |
| 400    | Validation error (missing fields, invalid format) |
| 401    | Not authenticated (missing JWT)                   |
| 403    | Not authorized (CommentOwnershipGuard)            |
| 404    | Resource not found (post, comment, parent)        |
| 409    | Conflict (parent in different post)               |
| 429    | Rate limit exceeded                               |
| 500    | Server error                                      |

### Testing the Module

```bash
# Run migrations
npx prisma migrate deploy

# Start server
npm run start:dev

# Create comment
curl -X POST http://localhost:3000/posts/1/comments \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Great post!",
    "postId": 1
  }'

# Get comments tree
curl http://localhost:3000/posts/1/comments

# Update comment
curl -X PATCH http://localhost:3000/comments/1 \
  -H "Authorization: Bearer <JWT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"content": "Updated text"}'

# Delete comment (soft delete)
curl -X DELETE http://localhost:3000/comments/1 \
  -H "Authorization: Bearer <JWT_TOKEN>"
```

### Integration with Posts Module

Comments are automatically integrated with posts:

- Each post can have unlimited nested comments
- Post authors can moderate (delete) comments on their posts
- Comments inherit post's visibility (public posts = public comments)

### Future Enhancements

1. **Analytics**: Comment count, engagement metrics
2. **Moderation**: Report comments, automated filtering
3. **Notifications**: Notify when replied to
4. **Pagination**: Lazy-load comments for large threads
5. **Search**: Full-text search across comments
6. **Reactions**: Like/react to comments
7. **Mentions**: @user mentions with notifications

### Module Export

```typescript
// In app.module.ts
import { CommentsModule } from './comments/comments.module';

@Module({
  imports: [
    PrismaModule,
    RedisModule,
    AuthModule,
    PostsModule,
    CommentsModule, // ← Added
  ],
})
export class AppModule {}
```

The module is now fully integrated and ready for production use!
