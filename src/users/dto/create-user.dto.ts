import { IsEmail, IsString, IsNotEmpty, IsEnum, IsOptional } from 'class-validator';
import { UserRole } from '@prisma/client';

export class CreateUserDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsString()
  @IsNotEmpty()
  password_hash: string;

  @IsEnum(UserRole)
  @IsOptional()
  role?: UserRole;
}
