import { IsString, IsOptional, MaxLength, IsUrl, IsArray, ArrayMaxSize } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  fullName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  headline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  bio?: string;

  @IsOptional()
  @IsString()
  @IsUrl()
  githubUrl?: string;

  @IsOptional()
  @IsString()
  @IsUrl()
  linkedinUrl?: string;

  @IsOptional()
  @IsString()
  @IsUrl()
  websiteUrl?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  skills?: string[];
}
