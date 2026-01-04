import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { ChangePasswordDto } from '../dto/auth.dto';

/**
 * ChangePasswordService - Xử lý đổi mật khẩu
 * 
 * Workflow:
 * 1. Verify current password
 * 2. Hash new password
 * 3. Update in DB
 * 4. Increment token_version (revoke all tokens)
 * 5. Revoke all refresh tokens
 */
@Injectable()
export class ChangePasswordService {
  constructor(private prisma: PrismaService) {}

  async execute(userId: number, dto: ChangePasswordDto): Promise<{ success: boolean }> {
    // 1. Validation
    if (dto.new_password !== dto.new_password_confirm) {
      throw new BadRequestException('New passwords do not match');
    }

    if (dto.current_password === dto.new_password) {
      throw new BadRequestException(
        'New password must be different from current password',
      );
    }

    // 2. Get user
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // 3. Verify current password
    const passwordMatches = await bcrypt.compare(
      dto.current_password,
      user.password_hash,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    // 4. Hash new password
    const newPasswordHash = await bcrypt.hash(dto.new_password, 10);

    // 5. Update user: new password + increment token_version
    await this.prisma.users.update({
      where: { id: userId },
      data: {
        password_hash: newPasswordHash,
        token_version: {
          increment: 1, // This invalidates all existing tokens
        },
      },
    });

    // 6. Revoke all refresh tokens
    await this.prisma.refresh_tokens.updateMany({
      where: { user_id: userId },
      data: { is_revoked: true },
    });

    return { success: true };
  }
}
