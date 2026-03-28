import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { UserRole } from '@prisma/client';

export class UpdateUserStatusDto {
  @IsBoolean()
  @IsOptional()
  is_banned?: boolean;

  @IsEnum(UserRole)
  @IsOptional()
  role?: UserRole;
}
