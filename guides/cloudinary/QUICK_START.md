# DevShare Forum - Quick Start Guide

## 🔐 Prerequisites

### Environment Variables

Add these to your `.env` file:

```env
# Cloudinary Configuration
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret  # ⚠️ KEEP SECURE - Backend only

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/devshare_forum_db

# JWT
JWT_ACCESS_TOKEN_SECRET=your_access_secret
JWT_REFRESH_TOKEN_SECRET=your_refresh_secret

# Redis
REDIS_URL=redis://localhost:6379
```

## 🚀 Setup Steps

### 1. Install Dependencies

```bash
pnpm install
# or
npm install
```

### 2. Run Migrations

```bash
npx prisma migrate deploy
# or for development
npx prisma migrate dev
```

### 3. Verify Database

```bash
npx prisma studio  # Opens web UI to verify schema
```

### 4. Start Application

```bash
npm run start:dev
```

## 📡 API Usage Examples

### 1. User Registration & Login

```bash
# Register
POST /auth/register
{
  "email": "user@example.com",
  "password": "securepassword",
  "full_name": "John Doe"
}

# Login
POST /auth/login
{
  "email": "user@example.com",
  "password": "securepassword"
}
# Returns: { access_token, refresh_token, user: {...} }
```

### 2. Upload an Image

```bash
# Upload image to Cloudinary
POST /media/upload
Headers: Authorization: Bearer {ACCESS_TOKEN}
Body: multipart/form-data with "file" field

Response:
{
  "id": 42,
  "url": "https://res.cloudinary.com/xxx/image/upload/xxx",
  "publicId": "devshare/abc123xyz",
  "fileName": "photo.jpg"
}
```

### 3. Create a Draft Post

```bash
POST /posts
Headers: Authorization: Bearer {ACCESS_TOKEN}
{
  "title": "My Great Post",
  "content_markdown": "## Introduction\n\nThis is my post...",
  "status": "DRAFT",  // ← NEW: DRAFT, PUBLISHED, ARCHIVED
  "tags": ["typescript", "nestjs", "backend"]
}

Response: { id, title, status, slug, ... }
```

### 4. Publish Draft

```bash
PUT /posts/:postId
Headers: Authorization: Bearer {ACCESS_TOKEN}
{
  "status": "PUBLISHED"  // ← Transition to public
}

# Now:
# - Cached in Redis
# - Activity logged
# - Visible in feeds
```

### 5. Get User Profile with Activity Chart

```bash
# Public endpoint - no auth needed
GET /users/:email/profile

Response:
{
  "id": 1,
  "email": "user@example.com",
  "full_name": "John Doe",
  "profile_avatar": "https://...",
  "karma": 120,
  "created_at": "2025-01-09T12:34:56Z",
  "stats": {
    "postCount": 5,
    "commentCount": 23,
    "karma": 120
  },
  "activityChart": [
    { "date": "2025-01-01", "count": 2 },
    { "date": "2025-01-02", "count": 0 },
    { "date": "2025-01-03", "count": 1 },
    { "date": "2025-01-04", "count": 4 },
    ...
    { "date": "2025-01-09", "count": 3 }
  ]
}
```

### 6. Create Comment (Auto-tracked)

```bash
POST /posts/:postId/comments
Headers: Authorization: Bearer {ACCESS_TOKEN}
{
  "content": "Great post! I really learned a lot...",
  "parentId": null  // or reply_to_comment_id
}

# Automatically:
# ✅ Logged as COMMENT_CREATED in user_activities
# ✅ Contributes to activity chart
# ✅ Triggers notifications
```

### 7. Delete Post with Media Cleanup

```bash
DELETE /posts/:postId
Headers: Authorization: Bearer {ACCESS_TOKEN}

# Automatically:
# ✅ All linked media deleted from Cloudinary
# ✅ All activity logs deleted
# ✅ Redis cache invalidated
# ✅ Post soft-deleted
```

## 📊 Activity Tracking

### How Activity is Logged

**Automatic Logging:**

1. **POST_CREATED** - When user publishes a post (not drafts)
2. **POST_UPDATED** - When user updates a published post
3. **COMMENT_CREATED** - Every comment creation

**Not Logged:**

- Draft posts (only on publish)
- Deleted posts (logs also deleted)
- Post views (separate counter)

### Accessing Activity Data

```bash
# Get full profile with 365-day activity
GET /users/john@example.com/profile

# Returns:
{
  ...user data,
  "activityChart": [
    { "date": "2024-01-15", "count": 2 },
    { "date": "2024-01-16", "count": 0 },
    { "date": "2024-01-17", "count": 5 },
    ...
  ]
}
```

**Chart Format:**

- **date**: YYYY-MM-DD format
- **count**: Number of activities on that day
- **range**: Last 365 days from today
- **efficiency**: Fetched in <200ms with proper indexing

## 🖼️ Image Management

### Upload Images

```bash
POST /media/upload
Headers:
  Authorization: Bearer {TOKEN}
Body: multipart/form-data
  - file: <image file>

# Returns:
{
  "id": 42,
  "url": "https://res.cloudinary.com/...",
  "publicId": "devshare/abc123xyz"
}
```

### Link Image to Post

```bash
POST /media/:mediaId/link-to-post/:postId
Headers: Authorization: Bearer {TOKEN}

# Now image is associated with post
# Deleted when post is deleted
```

### Delete Image

```bash
DELETE /media/:mediaId
Headers: Authorization: Bearer {TOKEN}

# Removes from:
# ✅ Cloudinary (production)
# ✅ Database
```

### Get Your Media Library

```bash
POST /media/user/library
Headers: Authorization: Bearer {TOKEN}

# Returns: [{ id, url, fileName, created_at, ... }]
```

## 🔒 Security Checklist

- ✅ Never expose `CLOUDINARY_API_SECRET` to frontend
- ✅ All uploads go through `/media/upload` endpoint
- ✅ File validation: type (image/\*) + size (10MB max)
- ✅ User can only manage their own images
- ✅ Cleanup happens automatically on post delete
- ✅ JWT tokens required for authenticated endpoints
- ✅ Soft deletes preserve data integrity

## 🐛 Troubleshooting

### Image Upload Fails

```
Problem: "CLOUDINARY_API_SECRET not configured"
Solution: Check .env file has all three Cloudinary variables

Problem: "File size exceeds 10MB limit"
Solution: Compress image or increase limit in media.controller.ts

Problem: "File must be an image"
Solution: Ensure file is JPEG, PNG, GIF, or WebP format
```

### Activity Chart is Empty

```
Problem: No activities showing for user
Solution:
1. Verify user has created posts/comments
2. Check database: SELECT * FROM user_activities WHERE user_id = X
3. Ensure schema migration was applied

Problem: Query too slow
Solution:
1. Verify index exists: \d user_activities
2. Should see: "idx_user_activities_user_created" index
3. If missing, run: npx prisma migrate reset
```

### Draft Posts Not Saved

```
Problem: Draft appears as published
Solution:
1. When creating, explicitly set: "status": "DRAFT"
2. Draft posts won't appear in public feeds
3. Draft posts not cached in Redis

Problem: Draft deleted activity logged
Solution: Activity only logged for PUBLISHED posts
```

## 📈 Performance Tips

### Optimization Checklist

- ✅ Use draft for longer posts (not cached)
- ✅ Image uploads are async (non-blocking)
- ✅ Activity queries use indexed range scans
- ✅ Redis caches public posts (1 hour TTL)
- ✅ Media deletion is fire-and-forget

### Database Optimization

```sql
-- Verify critical index
SELECT indexname FROM pg_indexes
WHERE tablename = 'user_activities'
AND indexname LIKE '%user%created%';

-- Should return: idx_user_activities_user_created

-- Check query performance
EXPLAIN ANALYZE
SELECT DATE(created_at), COUNT(*)
FROM user_activities
WHERE user_id = 1
AND created_at >= NOW() - INTERVAL '365 days'
GROUP BY DATE(created_at);
```

## 🚀 Deployment

### Pre-deployment Checklist

- [ ] Environment variables configured
- [ ] Database migrations run: `npx prisma migrate deploy`
- [ ] Build successful: `npm run build`
- [ ] No TypeScript errors: `npx tsc --noEmit`
- [ ] Tests passing: `npm test`
- [ ] Cloudinary credentials verified

### Production Build

```bash
npm run build
npm run start:prod
```

## 📚 Documentation References

- **Cloudinary Docs:** https://cloudinary.com/documentation/image_upload_api_reference
- **NestJS Docs:** https://docs.nestjs.com
- **Prisma Docs:** https://www.prisma.io/docs
- **PostgreSQL Docs:** https://www.postgresql.org/docs

## 🎯 Next Steps

1. **Test API endpoints** using provided examples
2. **Setup Cloudinary account** if not done
3. **Configure environment variables**
4. **Run database migrations**
5. **Start development server**
6. **Create sample data** (users, posts, comments)
7. **Verify activity chart** appears in profile

---

**Happy coding! 🚀**
