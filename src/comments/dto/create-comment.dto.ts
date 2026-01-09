import {
  IsString,
  IsInt,
  IsOptional,
  MinLength,
  MaxLength,
  IsPositive,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * CreateCommentDto - Request DTO for creating comments
 * 
 * Validations:
 * - content: 1-5000 characters (sanitized by service)
 * - postId: positive integer
 * - parentId: optional positive integer (for nested replies)
 * 
 * Security:
 * - Content is trimmed and later sanitized using isomorphic-dompurify
 * - XSS prevention is handled at service level
 */
export class CreateCommentDto {
  @IsString({ message: 'Content must be a string' })
  @MinLength(1, { message: 'Content must be at least 1 character' })
  @MaxLength(5000, { message: 'Content must not exceed 5000 characters' })
  @Transform(({ value }) => value?.trim())
  content: string;

  @IsInt({ message: 'postId must be an integer' })
  @IsPositive({ message: 'postId must be a positive integer' })
  postId: number;

  @IsInt({ message: 'parentId must be an integer' })
  @IsPositive({ message: 'parentId must be a positive integer' })
  @IsOptional()
  parentId?: number;
}
