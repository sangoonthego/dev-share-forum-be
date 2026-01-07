import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards, Res, Get, Req } from "@nestjs/common";
import type { Response, Request } from "express";
import { RegisterDto, LoginDto, ChangePasswordDto, UserProfileResponse, AuthResponse } from "./dto/auth.dto"; 
import { RegisterService } from "./services/register.service";
import { LoginService } from "./services/login.service";
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

    // ═══════════════════════════════════════════════════════════════════════
    // SECURE COOKIE CONFIG
    // ═══════════════════════════════════════════════════════════════════════
    // httpOnly: Prevents JavaScript access (XSS protection)
    // secure: Only sent over HTTPS in production
    // sameSite: 'Strict' prevents CSRF attacks
    //   - 'Strict': Cookie not sent even in cross-site navigation
    //   - 'Lax': Sent only for top-level navigation (safer, SPA friendly)
    // maxAge: 7 days = 604,800,000 ms
    res.cookie('refresh_token', tokens.refresh_token, {
      httpOnly: true, // Prevent XSS access
      secure: process.env.NODE_ENV === 'production', // HTTPS only in prod
      sameSite: 'strict', // CSRF protection (or 'lax' for SPA)
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/', // Available site-wide
      domain: process.env.COOKIE_DOMAIN, // Optional: specify domain
    });

    return { access_token: tokens.access_token };
  }

  @UseGuards(AtGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @User() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Calculate remaining expiry time (JWT typically expires in 15 minutes)
    const expiresIn = 15 * 60; // 15 minutes

    // Blacklist JWT + revoke all RT
    // JTI must be provided for blacklisting
    if (user.jti) {
      await this.authService.logout(user.jti, user.sub, expiresIn);
    } else {
      // Fallback: just revoke RT
      await this.authService.forceLogoutAllSessions(user.sub);
    }

    // Clear httpOnly cookie
    res.clearCookie('refresh_token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
    });

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

    // Set new RT cookie with secure settings
    res.cookie('refresh_token', tokens.refresh_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/',
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