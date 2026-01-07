export class PostResponseDto {
  id: number;
  title: string;
  slug: string;
  content_markdown: string;
  is_published: boolean;
  view_count: number;
  author_id: number;
  author?: {
    id: number;
    email: string;
    full_name: string;
  };
  tags?: {
    id: number;
    name: string;
    slug: string;
  }[];
  created_at: Date;
  updated_at: Date;
}

export class PaginatedPostsResponseDto {
  data: PostResponseDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
