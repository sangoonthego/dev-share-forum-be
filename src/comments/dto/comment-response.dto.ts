/**
 * CommentResponseDto - Response DTO for comments with nested structure
 *
 * **Features:**
 * - Author details (id, email, full_name, profile_avatar)
 * - Nested replies array for hierarchical display
 * - Depth tracking (max 5 levels)
 * - Atomic reaction counters (likes, dislikes)
 * - Soft delete and ban status flags
 * - Timestamps for audit trail
 *
 * **Fields:**
 * - `depth`: 0 = root comment, 5 = max nesting level
 * - `likes`, `dislikes`: Atomic counters (no race conditions)
 * - `isDeleted`: Soft-deleted comment (content = "[This comment has been removed]")
 * - `isUserBanned`: Author is banned (content = "[Comment from banned user]")
 *
 * **Content Display Logic:**
 * ```
 * If deleted and banned: "[Removed: User banned]"
 * Else if deleted: "[This comment has been removed]"
 * Else if banned: "[Comment from banned user]"
 * Else: actual comment content
 * ```
 */
export class CommentResponseDto {
  id: number;
  content: string;
  postId: number;
  authorId: number;
  author: {
    id: number;
    email: string;
    full_name: string | null;
    profile_avatar: string | null;
  };
  parentId: number | null;
  depth: number; // 0-5: max depth limit for anti-abuse
  likes: number; // Atomic counter
  dislikes: number; // Atomic counter
  isDeleted: boolean; // Soft-deleted (deleted_at !== null)
  isUserBanned?: boolean; // Author account is banned
  createdAt: Date;
  updatedAt: Date;
  replies: CommentResponseDto[];
}

/**
 * PaginatedCommentsResponseDto - Paginated response for comments tree
 *
 * Returns:
 * - data: hierarchical comment tree (root level or full tree)
 * - total: total number of comments (all levels)
 */
export class PaginatedCommentsResponseDto {
  data: CommentResponseDto[];
  total: number;
}
