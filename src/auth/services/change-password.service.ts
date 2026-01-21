import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { RedisService } from 'src/redis/redis.service';
import * as bcrypt from 'bcrypt';
import { ChangePasswordDto } from '../dto/auth.dto';

@Injectable()
export class ChangePasswordService {
  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
  ) {}

  async execute(userId: number, dto: ChangePasswordDto): Promise<{ success: boolean }> {
    if (dto.new_password !== dto.new_password_confirm) {
      throw new BadRequestException('New passwords do not match');
    }

    if (dto.current_password === dto.new_password) {
      throw new BadRequestException(
        'New password must be different from current password',
      );
    }

    const user = await this.prisma.users.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const passwordMatches = await bcrypt.compare(
      dto.current_password,
      user.password_hash,
    );

    if (!passwordMatches) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const newPasswordHash = await bcrypt.hash(dto.new_password, 10);

    await this.prisma.users.update({
      where: { id: userId },
      data: {
        password_hash: newPasswordHash,
        token_version: {
          increment: 1,
        },
      },
    });

    await this.redisService.revokeAllTokens(userId);

    return { success: true };
  }
}
