import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards, Res, Get, Req } from "@nestjs/common";
import type { Response, Request } from "express";
import { RegisterDto, LoginDto, ChangePasswordDto, UserProfileResponse, AuthResponse } from "./dto/auth.dto"; 
import { RegisterService } from "./services/register.service";
import { LoginService } from "./services/login.service";
import { LogoutService } from "./services/logout.service";
import { AuthService } from "./services/auth.service";
import { UserService } from "./services/user.service";
import { ChangePasswordService } from "./services/change-password.service";
import { AtGuard } from "src/common/guards/at.guard";
import { RtGuard } from "src/common/guards/rt.guard";
import { RateLimitGuard } from "src/common/guards/rate-limit.guard";
import { User } from "src/common/decorators/user.decorator";
import type { JwtPayload } from "./dto/auth.dto";

@Controller('auth')
export class AuthController {
  constructor(
    private registerService: RegisterService,
    private loginService: LoginService,
    private logoutService: LogoutService,
    private authService: AuthService,
    private userService: UserService,
    private changePasswordService: ChangePasswordService,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterDto) {
    return this.registerService.execute(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  async login(
    @Body() dto: LoginDto, 
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const ipAddress = this.getClientIp(req);
    const userAgent = req.get('user-agent') || 'unknown';

    const tokens = await this.loginService.execute(dto, ipAddress, userAgent);

    res.cookie('refresh_token', tokens.refresh_token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return { access_token: tokens.access_token };
  }

  @UseGuards(AtGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@User('sub') userId: number, @Res({ passthrough: true }) res: Response) {
    await this.logoutService.execute(userId);
    res.clearCookie('refresh_token');
    return { success: true };
  }

  @UseGuards(RtGuard)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @User() user: JwtPayload & { refreshToken: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.authService.refreshTokens(user.sub, user.refreshToken);

    res.cookie('refresh_token', tokens.refresh_token, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return { access_token: tokens.access_token };
  }

  @UseGuards(AtGuard)
  @Get('me')
  @HttpCode(HttpStatus.OK)
  async getMe(@User('sub') userId: number): Promise<UserProfileResponse> {
    return this.userService.getUserProfile(userId);
  }

  @UseGuards(AtGuard)
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @User('sub') userId: number,
    @Body() dto: ChangePasswordDto,
  ) {
    return this.changePasswordService.execute(userId, dto);
  }

  /**
   * Extract client IP from request
   * Considers X-Forwarded-For header for proxies
   */
  private getClientIp(request: Request): string {
    const forwarded = request.get('x-forwarded-for');
    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }
    return (request.socket?.remoteAddress || '0.0.0.0').split(':').pop() || '0.0.0.0';
  }
}