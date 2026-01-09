# DevShare Forum - Complete API Reference

## 🎯 Base URL

```
http://localhost:3000
```

## 🔐 Authentication

All protected endpoints require:

```
Header: Authorization: Bearer {ACCESS_TOKEN}
```

---

## 📤 Media Management API

### Upload Image

```
POST /media/upload
Headers:
  Authorization: Bearer {token}
  Content-Type: multipart/form-data

Body:
  file: <binary image file>

Response (200):
{
  "id": 42,
  "url": "https://res.cloudinary.com/dxxxxx/image/upload/v1234567890/devshare/abc123.jpg",
  "publicId": "devshare/abc123",
  "fileName": "photo.jpg"
}

Errors:
  400: "No file provided"
  400: "File must be an image"
  400: "File size exceeds 10MB limit"
  500: "Upload failed: ..."
```

### Link Image to Post

```
POST /media/:mediaId/link-to-post/:postId
Headers:
  Authorization: Bearer {token}

Response (200):
{
  "id": 42,
  "cloudinary_url": "https://res.cloudinary.com/...",
  "public_id": "devshare/abc123",
  "user_id": 1,
  "post_id": 5,
  "created_at": "2025-01-09T...",
  "updated_at": "2025-01-09T..."
}

Errors:
  400: "Media not found"
  400: "Post not found"
  403: "Cannot manage other users media"
  403: "Cannot link to other users posts"
```

### Delete Image

```
DELETE /media/:mediaId
Headers:
  Authorization: Bearer {token}

Response (200):
{
  "message": "Image deleted successfully"
}

Errors:
  400: "Media not found"
  403: "Cannot delete other users media"
  500: "Deletion failed: ..."
```

### Get User's Media Library

```
POST /media/user/library
Headers:
  Authorization: Bearer {token}

Response (200):
[
  {
    "id": 42,
    "cloudinary_url": "https://res.cloudinary.com/...",
    "public_id": "devshare/abc123",
    "file_name": "photo.jpg",
    "file_size": 125000,
    "mime_type": "image/jpeg",
    "user_id": 1,
    "post_id": null,
    "alt_text": null,
    "created_at": "2025-01-09T12:34:56Z",
    "updated_at": "2025-01-09T12:34:56Z"
  },
  ...
]

Note: Returns last 50 items, ordered by creation date (newest first)
```

---

## 👤 User Profile & Activity API

### Get Public User Profile

```
GET /users/:email/profile
Headers: None (public endpoint)

Parameters:
  :email - User's email (e.g., "admin@example.com")

Response (200):
{
  "id": 1,
  "email": "admin@example.com",
  "full_name": "System Administrator",
  "profile_avatar": "https://res.cloudinary.com/.../avatar.jpg",
  "karma": 150,
  "created_at": "2024-12-15T10:30:00Z",
  "stats": {
    "postCount": 12,
    "commentCount": 45,
    "karma": 150
  },
  "activityChart": [
    { "date": "2024-12-10", "count": 2 },
    { "date": "2024-12-11", "count": 0 },
    { "date": "2024-12-12", "count": 3 },
    { "date": "2024-12-13", "count": 1 },
    { "date": "2024-12-14", "count": 5 },
    { "date": "2024-12-15", "count": 2 },
    ...
    { "date": "2025-01-09", "count": 3 }
  ]
}

Errors:
  404: "User not found"

Performance:
  Typical response time: 50-200ms (with proper indexing)
  Data: 365-day activity history (last year)
```

### Get Current User Profile

```
GET /users/me/profile
Headers:
  Authorization: Bearer {token}

Response (200):
{
  "id": 1,
  "email": "admin@example.com",
  "full_name": "System Administrator",
  "phone": "+1234567890",
  "profile_avatar": "https://...",
  "role": "ADMIN",
  "karma": 150,
  "created_at": "2024-12-15T10:30:00Z",
  "updated_at": "2025-01-09T12:34:56Z"
}

Errors:
  401: "Unauthorized"
  404: "User not found"
```

### Update User Profile

```
PUT /users/profile
Headers:
  Authorization: Bearer {token}
  Content-Type: application/json

Body (all optional):
{
  "full_name": "John Doe",
  "phone": "+1234567890",
  "profile_avatar": "https://res.cloudinary.com/.../avatar.jpg"
}

Response (200):
{
  "id": 1,
  "email": "user@example.com",
  "full_name": "John Doe",
  "phone": "+1234567890",
  "profile_avatar": "https://...",
  "role": "USER",
  "karma": 120,
  "created_at": "2024-12-15T10:30:00Z",
  "updated_at": "2025-01-09T15:45:30Z"
}

Errors:
  401: "Unauthorized"
  404: "User not found"
```

---

## 📝 Posts API

### Create Post (with Draft Support)

```
POST /posts
Headers:
  Authorization: Bearer {token}
  Content-Type: application/json

Body:
{
  "title": "Introduction to TypeScript",
  "content_markdown": "# Hello\n\nThis is my first post...",
  "status": "DRAFT",                  // NEW: DRAFT, PUBLISHED, ARCHIVED
  "is_published": false,              // Legacy (deprecated)
  "tags": ["typescript", "backend", "nestjs"]
}

Response (201):
{
  "id": 15,
  "title": "Introduction to TypeScript",
  "slug": "introduction-to-typescript-abc123",
  "content_markdown": "# Hello\n\nThis is my first post...",
  "status": "DRAFT",
  "is_published": false,
  "view_count": 0,
  "author_id": 1,
  "author": {
    "id": 1,
    "email": "user@example.com",
    "full_name": "John Doe"
  },
  "tags": [
    { "id": 1, "name": "typescript" },
    { "id": 2, "name": "backend" },
    { "id": 3, "name": "nestjs" }
  ],
  "created_at": "2025-01-09T15:45:30Z",
  "updated_at": "2025-01-09T15:45:30Z"
}

Notes:
  - status="DRAFT" posts are NOT cached in Redis
  - status="DRAFT" posts do NOT appear in public feeds
  - Activity only logged for status="PUBLISHED"
  - Only author can view their drafts

Errors:
  400: "Title must be at least 3 characters"
  400: "Content must be at least 10 characters"
  401: "Unauthorized"
```

### Get Post by Slug

```
GET /posts/:slug
Headers: None (public, but respects status)

Parameters:
  :slug - Post slug

Response (200):
{
  "id": 15,
  "title": "Introduction to TypeScript",
  "slug": "introduction-to-typescript-abc123",
  "content_markdown": "# Hello\n\nThis is my first post...",
  "status": "PUBLISHED",
  "is_published": true,
  "view_count": 42,
  "author": { ... },
  "tags": [ ... ],
  "created_at": "2025-01-09T15:45:30Z",
  "updated_at": "2025-01-09T15:45:30Z"
}

Notes:
  - PUBLISHED posts cached for 1 hour
  - DRAFT posts NOT cached (checked on every request)
  - View count incremented atomically
  - Auto-caches on successful fetch

Errors:
  403: "Cannot access draft posts"
  404: "Post not found"
```

### Update Post

```
PUT /posts/:postId
Headers:
  Authorization: Bearer {token}
  Content-Type: application/json

Body (all optional):
{
  "title": "Updated Title",
  "content_markdown": "Updated content...",
  "status": "PUBLISHED",              // Can change from DRAFT → PUBLISHED
  "tags": ["tag1", "tag2"]
}

Response (200): Updated post object

Notes:
  - Slug regenerated if title changes
  - Activity logged only if status="PUBLISHED"
  - Cache invalidated
  - Validation same as create

Errors:
  400: "Post not found"
  401: "Unauthorized"
  403: "Cannot modify other users posts"
```

### Delete Post

```
DELETE /posts/:postId
Headers:
  Authorization: Bearer {token}

Response (200): { message: "Post deleted successfully" }

Notes:
  - Soft delete (sets deleted_at timestamp)
  - All linked media_assets deleted from Cloudinary
  - All user_activities related to this post deleted
  - Redis cache invalidated
  - Can be recovered (soft delete)

Errors:
  400: "Post not found"
  401: "Unauthorized"
  403: "Cannot delete other users posts"
```

### Get Paginated Posts

```
GET /posts?page=1&limit=10&is_published=true
Headers: None (public)

Query Parameters:
  page: number (default: 1)
  limit: number (default: 10)
  is_published: boolean (default: true)

Response (200):
{
  "data": [
    { /* post objects */ },
    ...
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 156,
    "pages": 16
  }
}

Notes:
  - Only PUBLISHED posts shown (status="PUBLISHED")
  - DRAFT posts never shown in public feed
  - Cached by page/limit/role combination
  - Cache TTL: 1 hour

Errors: None (empty array if no posts)
```

---

## 💬 Comments API

### Create Comment

```
POST /posts/:postId/comments
Headers:
  Authorization: Bearer {token}
  Content-Type: application/json

Body:
{
  "content": "Great post! I learned a lot from this.",
  "parentId": null                    // null for root, or comment ID for reply
}

Response (201):
{
  "id": 42,
  "content": "Great post! I learned a lot from this.",
  "post_id": 15,
  "author_id": 2,
  "author": {
    "id": 2,
    "email": "reader@example.com",
    "full_name": "Jane Smith"
  },
  "parent_id": null,
  "depth": 0,
  "likes": 0,
  "dislikes": 0,
  "created_at": "2025-01-09T16:00:00Z",
  "updated_at": "2025-01-09T16:00:00Z"
}

Notes:
  - Automatically logged as COMMENT_CREATED in user_activities
  - Contributes to user's contribution chart
  - Max depth: 5 levels (replies stay at depth 5)
  - Triggers notifications to post/parent author

Errors:
  400: "Content must be at least 1 character"
  400: "Post not found"
  400: "Parent comment not found"
  401: "Unauthorized"
```

### Get Comments Tree

```
GET /posts/:postId/comments
Headers: None (public)

Query Parameters:
  depth: number (0 for root only, null for all)
  sort: "newest" | "oldest" | "likes" (default: "newest")

Response (200):
[
  {
    "id": 42,
    "content": "Great post!",
    "depth": 0,
    "author": { ... },
    "likes": 5,
    "dislikes": 1,
    "replies": [
      {
        "id": 43,
        "content": "I agree!",
        "depth": 1,
        "replies": [ ... ]
      }
    ]
  },
  ...
]

Notes:
  - Hierarchical structure with nested replies
  - Lazy loading supported (depth parameter)
  - Cached by post ID and depth
  - Cache TTL: 1 hour
```

### Update Comment

```
PUT /posts/:postId/comments/:commentId
Headers:
  Authorization: Bearer {token}
  Content-Type: application/json

Body:
{
  "content": "Updated comment text..."
}

Response (200): Updated comment object

Errors:
  400: "Comment not found"
  401: "Unauthorized"
  403: "Cannot modify other users comments"
```

### Delete Comment

```
DELETE /posts/:postId/comments/:commentId
Headers:
  Authorization: Bearer {token}

Response (200): { message: "Comment deleted successfully" }

Notes:
  - Soft delete (sets deleted_at)
  - Replies preserved
  - Activity logs deleted
  - Cache invalidated

Errors:
  400: "Comment not found"
  401: "Unauthorized"
  403: "Cannot delete other users comments"
```

---

## 🔔 Activity Data Format

### Activity Types

```
POST_CREATED    - User created a post
POST_UPDATED    - User updated a post
COMMENT_CREATED - User created a comment
```

### Activity Chart (365-day)

```typescript
interface ActivityDay {
  date: string; // YYYY-MM-DD format
  count: number; // Number of activities that day
}

Example: [
  { date: '2024-12-10', count: 2 },
  { date: '2024-12-11', count: 0 },
  { date: '2024-12-12', count: 3 },
  ...{ date: '2025-01-09', count: 5 },
];
```

---

## ⚙️ Status Codes

### Success

- **200 OK** - Request successful
- **201 Created** - Resource created successfully

### Client Errors

- **400 Bad Request** - Invalid input/validation failed
- **401 Unauthorized** - Missing/invalid token
- **403 Forbidden** - Lacks permission for resource
- **404 Not Found** - Resource doesn't exist

### Server Errors

- **500 Internal Server Error** - Unexpected server error

---

## 🚀 Rate Limiting

Current limits (if rate-limit guard enabled):

- Public endpoints: 100 requests/minute
- Authenticated endpoints: 1000 requests/minute
- Upload endpoints: 50 uploads/minute per user

---

## 📊 Performance Tips

### Image Uploads

- Upload image → Save to DB (~100-500ms)
- Cloudinary processes async (~500-2000ms)
- Eager transformations generated automatically

### Activity Queries

- 365-day query: <200ms with index
- Without index: 5-30 seconds ❌
- Ensure `(user_id, created_at)` index exists

### Caching Strategy

- Published posts: 1 hour cache
- Draft posts: No cache
- Comments: 1 hour cache
- Activities: No cache

---

## 🔐 Security Headers

Recommended to add:

```
Content-Security-Policy: default-src 'self'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

---

## 📚 Examples

### Full Workflow: Create Post with Image

```bash
# 1. Upload image
curl -X POST http://localhost:3000/media/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@image.jpg"
# Response: { id: 42, url: "...", publicId: "..." }

# 2. Create draft post
curl -X POST http://localhost:3000/posts \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "My Post",
    "content_markdown": "![](42)",
    "status": "DRAFT"
  }'
# Response: { id: 15, status: "DRAFT", ... }

# 3. Link image to post
curl -X POST http://localhost:3000/media/42/link-to-post/15 \
  -H "Authorization: Bearer $TOKEN"
# Response: { id: 42, post_id: 15, ... }

# 4. Publish draft
curl -X PUT http://localhost:3000/posts/15 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "status": "PUBLISHED" }'
# Response: { id: 15, status: "PUBLISHED", ... }

# 5. View user's activity chart
curl http://localhost:3000/users/user@example.com/profile
# Response includes activityChart with 365 days of data
```

---

## 🔗 Related Documentation

- [IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md) - Technical details
- [QUICK_START.md](QUICK_START.md) - Setup & examples
- [FILE_STRUCTURE.md](FILE_STRUCTURE.md) - Project organization
