import {
  IsString,
  IsInt,
  IsOptional,
  MinLength,
  MaxLength,
  IsPositive,
} from 'class-validator';
import { Transform } from 'class-transformer';

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
