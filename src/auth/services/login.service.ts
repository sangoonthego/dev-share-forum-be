import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import * as bcrypt from 'bcrypt';
import { LoginDto, Tokens } from "../dto/auth.dto";
import { TokenService } from "./token.service";
import { LoginAuditService } from "./login-audit.service";
import { LoginStatus } from "@prisma/client";

@Injectable()
export class LoginService {
  constructor(
    private prisma: PrismaService,
    private tokenService: TokenService,
    private auditService: LoginAuditService,
  ) {}

  async execute(
    dto: LoginDto,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<Tokens> {
    const user = await this.prisma.users.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      await this.auditService.logLoginAttempt(
        null,
        LoginStatus.FAILED,
        ipAddress,
        userAgent,
        dto.email,
      );
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.password_hash);

    if (!passwordMatches) {
      await this.auditService.logLoginAttempt(
        null,
        LoginStatus.FAILED,
        ipAddress,
        userAgent,
        dto.email,
      );
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.tokenService.getTokens(
      user.id,
      user.email,
      user.role,
      user.token_version,
    );

    await this.auditService.logLoginAttempt(
      user.id,
      LoginStatus.SUCCESS,
      ipAddress,
      userAgent,
    );

    await this.auditService.clearFailedAttempts(user.email, ipAddress);

    return tokens;
  }
}