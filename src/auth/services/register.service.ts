import { Injectable, ConflictException, Logger } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { RegisterDto } from "../dto/auth.dto";
import { TokenService } from "./token.service";
import { Tokens } from "../dto/auth.dto";
import { RedisService } from "src/redis/redis.service";

@Injectable()
export class RegisterService {
  private logger = new Logger(RegisterService.name);

  constructor(
    private prisma: PrismaService,
    private tokenService: TokenService,
    private redisService: RedisService,
  ) { }

  async execute(dto: RegisterDto): Promise<{ message: string }> {
    const userExists = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (userExists) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const newUser = await this.prisma.user.create({
      data: {
        email: dto.email,
        password_hash: passwordHash,
        token_version: 1,
        is_verified: false,
        profile: {
          create: {
            fullName: dto.full_name || null,
            phone: dto.phone || null,
          }
        }
      },
    });

    const verificationToken = uuidv4();
    const redisKey = `verify_email:${verificationToken}`;

    // Store in Redis (TTL = 24 hours = 86400 seconds)
    await this.redisService.set(redisKey, newUser.id.toString(), 86400);

    const verificationLink = `${process.env.FRONTEND_URL}/auth/verify-email?token=${verificationToken}`;
    this.logger.log(`Sending email to: ${newUser.email} Link: /auth/verify-email?token=${verificationToken}`);

    return { message: 'Registration successful. Please check your email to verify your account.' };
  }
}
