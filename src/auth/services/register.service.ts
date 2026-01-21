import { Injectable, ConflictException } from "@nestjs/common";
import { PrismaService } from "src/prisma/prisma.service";
import * as bcrypt from 'bcrypt';
import { RegisterDto } from "../dto/auth.dto";
import { TokenService } from "./token.service";
import { Tokens } from "../dto/auth.dto";

@Injectable()
export class RegisterService {
  constructor(
    private prisma: PrismaService,
    private tokenService: TokenService,
  ) {}

  async execute(dto: RegisterDto): Promise<Tokens> {
    const userExists = await this.prisma.users.findUnique({
      where: { email: dto.email },
    });

    if (userExists) throw new ConflictException('Email already registered');

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const newUser = await this.prisma.users.create({
      data: {
        email: dto.email,
        password_hash: passwordHash,
        full_name: dto.full_name,
        token_version: 1, 
      },
    });

    const tokens = await this.tokenService.getTokens(
      newUser.id,
      newUser.email,
      newUser.role,
      newUser.token_version,
    );

    return tokens;
  }
}