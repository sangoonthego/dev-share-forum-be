import { IsString, IsBoolean, IsArray, IsOptional, MinLength, MaxLength, IsEnum } from 'class-validator';
import { Transform } from 'class-transformer';
import { PostStatus } from '@prisma/client';

export class CreatePostDto {
  @IsString({ message: 'Title must be a string' })
  @MinLength(3, { message: 'Title must be at least 3 characters' })
  @MaxLength(200, { message: 'Title must not exceed 200 characters' })
  @Transform(({ value }) => value?.trim())
  title: string;

  @IsString({ message: 'Content must be a string' })
  @MinLength(10, { message: 'Content must be at least 10 characters' })
  @MaxLength(50000, { message: 'Content must not exceed 50000 characters' })
  @Transform(({ value }) => value?.trim())
  content_markdown: string;

  @IsBoolean({ message: 'is_published must be a boolean' })
  @IsOptional()
  is_published?: boolean = false;

  @IsEnum(PostStatus, { message: 'Status must be DRAFT, PUBLISHED, or ARCHIVED' })
  @IsOptional()
  status?: PostStatus = 'PUBLISHED';

  @IsArray({ message: 'Tags must be an array' })
  @IsString({ each: true, message: 'Each tag must be a string' })
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value.map(tag => tag.trim().toLowerCase()).filter(tag => tag.length > 0) : []))
  tags?: string[] = [];
}
