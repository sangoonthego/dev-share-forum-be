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
  depth: number; 
  likes: number; 
  dislikes: number; 
  isDeleted: boolean; 
  isUserBanned?: boolean; 
  createdAt: Date;
  updatedAt: Date;
  replies: CommentResponseDto[];
}

export class PaginatedCommentsResponseDto {
  data: CommentResponseDto[];
  total: number;
}
