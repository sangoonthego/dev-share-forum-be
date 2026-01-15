# Semantic Search: Quick Fix Reference

## The Problem

```
Error: argument of LIMIT must be type bigint, not type vector
```

**Cause:** Parameter mapping issue - vector was going to LIMIT clause

## The Solution (3 Steps)

### Step 1: Format Vector as JSON

```typescript
const embeddingString = JSON.stringify(queryEmbedding);
```

### Step 2: Validate Limit

```typescript
const limitInt = Math.max(1, Math.min(limit, 100));
```

### Step 3: Use $queryRawUnsafe with Explicit Parameters

```typescript
const sql = `...LIMIT $2::bigint`;
const vectorResults = await this.prisma.$queryRawUnsafe<any[]>(
  sql,
  embeddingString, // $1
  limitInt, // $2
);
```

## Key Points

| Aspect              | Value                                       |
| ------------------- | ------------------------------------------- |
| **API Method**      | `$queryRawUnsafe()` (not `$queryRaw`)       |
| **Parameter Style** | PostgreSQL placeholders: `$1`, `$2`         |
| **Vector Format**   | JSON string: `"[0.1,0.2,...]"`              |
| **Type Casting**    | Explicit in SQL: `$1::vector`, `$2::bigint` |
| **Safety**          | Parameters passed as separate arguments     |

## Before vs After

```typescript
// ❌ BEFORE (broken)
const vectorResults = await this.prisma.$queryRaw`
  ...LIMIT ${limit}  // Template literal - wrong!
`;

// ✅ AFTER (fixed)
const vectorResults = await this.prisma.$queryRawUnsafe(
  `...LIMIT $2::bigint`, // Parameter placeholder
  embeddingString,
  limitInt,
);
```

## Files Modified

- ✅ `src/posts/posts.service.ts` - searchPosts() method (line 757-815)

## Status

- ✅ Build: Passing
- ✅ Types: All correct
- ✅ SQL: Valid
- 🟡 Testing: Ready (awaiting execution)
