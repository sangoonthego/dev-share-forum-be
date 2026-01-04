import { Injectable } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";

@Injectable()
export class LogoutService {
  constructor(private prisma: PrismaService) {}

  async execute(userId: number) {
    // Revoke token bằng cách update flag is_revoked hoặc set token về null
    await this.prisma.refresh_tokens.updateMany({
      where: {
        user_id: userId,
        is_revoked: false,
      },
      data: {
        is_revoked: true,
      },
    });
  }
}