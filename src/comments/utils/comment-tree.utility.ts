/**
 * CommentTreeUtility - Transform flat comment array into hierarchical tree
 * 
 * Purpose:
 * - Convert flat Prisma query results into nested tree structure
 * - Handle soft-deleted parents (show placeholder, preserve children)
 * - Maintain performance for large comment sets
 * 
 * Algorithm:
 * 1. Build a map of all comments by ID for O(1) lookup
 * 2. For each comment:
 *    - If it has a parent: add to parent's replies array
 *    - If no parent: add to root array
 * 3. Handle soft-deleted parents: children still appear but parent shows placeholder
 * 
 * Complexity:
 * - Time: O(n) where n = total comments
 * - Space: O(n) for the tree structure
 */

interface FlatComment {
  id: number;
  content: string;
  post_id: number;
  author_id: number;
  parent_id: number | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
  author: {
    id: number;
    email: string;
    full_name: string | null;
    profile_avatar: string | null;
  };
}

interface TreeComment {
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
  replies: TreeComment[];
}

export class CommentTreeUtility {
  /**
   * Transform flat comment array into hierarchical tree
   * 
   * @param flatComments - Flat array of comments from database
   * @returns Root-level comments with nested replies
   */
  static buildCommentTree(flatComments: FlatComment[]): TreeComment[] {
    if (flatComments.length === 0) {
      return [];
    }

    // Map for fast lookup: id -> TreeComment
    const commentMap = new Map<number, TreeComment>();

    // Convert flat comments to tree comments and populate map
    flatComments.forEach((flat) => {
      const treeComment: TreeComment = {
        id: flat.id,
        content: flat.deleted_at
          ? 'This comment has been removed'
          : flat.content,
        postId: flat.post_id,
        authorId: flat.author_id,
        author: flat.author,
        parentId: flat.parent_id,
        isDeleted: flat.deleted_at !== null,
        createdAt: flat.created_at,
        updatedAt: flat.updated_at,
        replies: [],
      };
      commentMap.set(flat.id, treeComment);
    });

    // Build tree structure
    const roots: TreeComment[] = [];

    flatComments.forEach((flat) => {
      const comment = commentMap.get(flat.id)!;

      if (flat.parent_id === null) {
        // Root level comment
        roots.push(comment);
      } else {
        // Child comment - add to parent's replies
        const parent = commentMap.get(flat.parent_id);
        if (parent) {
          parent.replies.push(comment);
        }
      }
    });

    return roots;
  }

  /**
   * Flatten tree back to array (useful for counting, filtering)
   * 
   * @param tree - Tree structure
   * @returns Flat array of all comments
   */
  static flattenCommentTree(tree: TreeComment[]): TreeComment[] {
    const result: TreeComment[] = [];

    const traverse = (comments: TreeComment[]) => {
      comments.forEach((comment) => {
        result.push(comment);
        if (comment.replies.length > 0) {
          traverse(comment.replies);
        }
      });
    };

    traverse(tree);
    return result;
  }
}
