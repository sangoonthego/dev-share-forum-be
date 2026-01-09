/**
 * CommentResponseDto - Response DTO for comments with nested structure
 * 
 * Structure:
 * - Includes author details (id, email, full_name, profile_avatar)
 * - Supports nested replies array for hierarchical comments
 * - Timestamps for audit trail
 * 
 * Soft Delete Handling:
 * - isDeleted: true if comment was soft-deleted
 * - content: "This comment has been removed" for deleted comments
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
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
  replies: CommentResponseDto[];
}

/**
 * PaginatedCommentsResponseDto - Paginated response for comments tree
 * 
 * Returns:
 * - data: hierarchical comment tree (root level only)
 * - total: total number of comments (all levels)
 */
export class PaginatedCommentsResponseDto {
  data: CommentResponseDto[];
  total: number;
}
