import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards, Res, Get, Req } from "@nestjs/common";
import type { Response, Request } from "express";
import { RegisterDto, LoginDto, ChangePasswordDto, UserProfileResponse, AuthResponse, OAuthUserResponse } from "./dto/auth.dto"; 
import { RegisterService } from "./services/register.service";
import { LoginService } from "./services/login.service";
import { AuthService } from "./services/auth.service";
import { UserService } from "./services/user.service";
import { ChangePasswordService } from "./services/change-password.service";
import { AtGuard } from "src/common/guards/at.guard";
import { RtGuard } from "src/common/guards/rt.guard";
import { GoogleAuthGuard } from "src/common/guards/google-auth.guard";
import { GitHubAuthGuard } from "src/common/guards/github-auth.guard";
import { RateLimitGuard } from "src/common/guards/rate-limit.guard";
import { User } from "src/common/decorators/user.decorator";
import type { JwtPayload } from "./dto/auth.dto";
import { Public } from 'src/common/decorators/public.decorator';

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
  @Public()
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: RegisterDto) {
    return this.registerService.execute(dto);
  }

  @Post('login')
  @Public()
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
      httpOnly: true, // Prevent XSS access
      secure: process.env.NODE_ENV === 'production', 
      sameSite: 'strict', 
      maxAge: 7 * 24 * 60 * 60 * 1000, 
      path: '/', 
      domain: process.env.COOKIE_DOMAIN, 
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

  @Get('google')
  @Public()
  @UseGuards(GoogleAuthGuard)
  async googleAuth(
    @Req() req: Request,
  ) {
    // Passport GoogleAuthGuard will automatically redirect to Google
    // This method exists for route registration only
  }

  @Get('google/callback')
  @Public()
  @UseGuards(GoogleAuthGuard)
  async googleCallback(
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const user = req.user as OAuthUserResponse | undefined;

    if (!user) {
      return res.redirect(
        `${process.env.FRONTEND_URL}/auth/login?error=oauth_failed`,
      );
    }

    res.cookie('refresh_token', user.refresh_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', 
      maxAge: 7 * 24 * 60 * 60 * 1000, 
      path: '/',
      domain: process.env.COOKIE_DOMAIN,
    });

    const redirectUrl = new URL(
      `${process.env.FRONTEND_URL}/auth/oauth-callback`,
    );
    redirectUrl.searchParams.append('access_token', user.access_token);
    redirectUrl.searchParams.append('provider', 'google');
    redirectUrl.searchParams.append('email', user.email);

    return res.redirect(redirectUrl.toString());
  }

  @Get('github')
  @Public()
  @UseGuards(GitHubAuthGuard)
  async githubAuth(
    @Req() req: Request,
  ) {
    // Passport GitHubAuthGuard will automatically redirect to GitHub
    // This method exists for route registration only
  }

  @Get('github/callback')
  @Public()
  @UseGuards(GitHubAuthGuard)
  async githubCallback(
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const user = req.user as OAuthUserResponse | undefined;

    if (!user) {
      return res.redirect(
        `${process.env.FRONTEND_URL}/auth/login?error=oauth_failed`,
      );
    }

    // Set httpOnly cookie with Refresh Token
    res.cookie('refresh_token', user.refresh_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', // Lax for cross-site OAuth callback
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/',
      domain: process.env.COOKIE_DOMAIN,
    });

    // Redirect to frontend with access token
    // Frontend will extract token from URL and store in memory
    const redirectUrl = new URL(
      `${process.env.FRONTEND_URL}/auth/oauth-callback`,
    );
    redirectUrl.searchParams.append('access_token', user.access_token);
    redirectUrl.searchParams.append('provider', 'github');
    redirectUrl.searchParams.append('email', user.email);

    return res.redirect(redirectUrl.toString());
  }

  private getClientIp(request: Request): string {
    const forwarded = request.get('x-forwarded-for');
    if (forwarded) {
      return forwarded.split(',')[0].trim();
    }
    return (request.socket?.remoteAddress || '0.0.0.0').split(':').pop() || '0.0.0.0';
  }
}