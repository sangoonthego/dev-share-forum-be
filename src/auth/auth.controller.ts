import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards, UseInterceptors, Res, Get, Req, ForbiddenException, UnauthorizedException, ConflictException, BadRequestException, Logger } from "@nestjs/common";
import type { Response, Request } from "express";
import { RegisterDto, LoginDto, ChangePasswordDto, UserProfileResponse, AuthResponse, OAuthUserResponse, ExchangeCodeDto, VerifyEmailDto, ResendVerificationDto, ForgotPasswordDto, ResetPasswordDto } from "./dto/auth.dto";
import { RegisterService } from "./services/register.service";
import { LoginService } from "./services/login.service";
import { AuthService } from "./services/auth.service";
import { UserService } from "./services/user.service";
import { ChangePasswordService } from "./services/change-password.service";
import { CsrfService } from "./services/csrf.service";
import { AtGuard } from "src/common/guards/at.guard";
import { RtGuard } from "src/common/guards/rt.guard";
import { RefreshRateLimitGuard } from "src/common/guards/refresh-rate-limit.guard";
import { GoogleAuthGuard } from "src/common/guards/google-auth.guard";
import { GitHubAuthGuard } from "src/common/guards/github-auth.guard";
import { RateLimitGuard } from "src/common/guards/rate-limit.guard";
import { GlobalRateLimitGuard } from "src/common/guards/global-rate-limit.guard";
import { User } from "src/common/decorators/user.decorator";
import type { JwtPayload } from "./dto/auth.dto";
import { Public } from 'src/common/decorators/public.decorator';
import { SentryTracingInterceptor, TraceId } from "./decorators/sentry-tracing.decorator";
import { AuthErrorCode, AuthException } from "./dto/auth-error.dto";

@Controller('auth')
@UseInterceptors(SentryTracingInterceptor)
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private registerService: RegisterService,
    private loginService: LoginService,
    private authService: AuthService,
    private userService: UserService,
    private changePasswordService: ChangePasswordService,
    private csrfService: CsrfService,
  ) { }

  @Post('exchange-oauth-code')
  @Public()
  @HttpCode(HttpStatus.OK)
  async exchangeOAuthCode(
    @Body() dto: ExchangeCodeDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    try {
      const tokens = await this.authService.exchangeOAuthCode(dto.code);

      if (!tokens) {
        throw new UnauthorizedException('Invalid or expired authorization code');
      }

      // Set RT cookie
      res.cookie('refresh_token', tokens.refresh_token, {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/',
        domain: process.env.COOKIE_DOMAIN,
      });

      // Set CSRF token cookie
      this.csrfService.setTokenCookie(
        res,
        tokens.csrf_token,
        process.env.NODE_ENV === 'production',
      );

      return {
        access_token: tokens.access_token,
        csrf_token: tokens.csrf_token,
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Failed to exchange authorization code');
    }
  }

  @Post('register')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(RateLimitGuard)
  async register(@Body() dto: RegisterDto) {
    try {
      return await this.registerService.execute(dto);
    } catch (error) {
      if (error instanceof ConflictException) {
        throw new AuthException(
          AuthErrorCode.EMAIL_REGISTERED,
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  @Post('verify-email')
  @Public()
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto.token);
  }

  @Post('resend-verification')
  @Public()
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  async resendVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerification(dto.email);
  }

  @Post('forgot-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Post('reset-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.new_password);
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @TraceId() traceId: string,
  ): Promise<AuthResponse> {
    try {
      // CSRF validation in production
      const isProduction = process.env.NODE_ENV === 'production';
      if (isProduction && !this.csrfService.validateToken(req, isProduction)) {
        throw new AuthException(
          AuthErrorCode.CSRF_INVALID,
          HttpStatus.FORBIDDEN,
        );
      }

      const ipAddress = this.getClientIp(req);
      const userAgent = req.get('user-agent') || 'unknown';

      const tokens = await this.loginService.execute(dto, ipAddress, userAgent);

      // Set refresh token cookie
      res.cookie('refresh_token', tokens.refresh_token, {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/',
        domain: process.env.COOKIE_DOMAIN,
      });

      // Set CSRF token in cookie for future requests
      this.csrfService.setTokenCookie(res, tokens.csrf_token, isProduction);

      return {
        access_token: tokens.access_token,
        csrf_token: tokens.csrf_token, // Frontend needs this
      };
    } catch (error) {
      if (error instanceof AuthException) throw error;
      if (error instanceof UnauthorizedException) {
        throw new AuthException(
          AuthErrorCode.INVALID_CREDENTIALS,
          HttpStatus.UNAUTHORIZED,
        );
      }
      throw error;
    }
  }

  @UseGuards(AtGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @User() user: JwtPayload,
    @Res({ passthrough: true }) res: Response,
  ) {
    const expiresIn = 15 * 60; // 15 minutes (match AT expiry)

    // Clear both RT and CSRF cookies
    res.clearCookie('refresh_token', {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
    });
    this.csrfService.clearToken(res);

    if (user.jti) {
      this.authService.logout(user.jti, user.sub, expiresIn).catch((err) => this.logger.error('Logout cleanup failed', err));
    } else {
      this.authService.forceLogoutAllSessions(user.sub).catch((err) => this.logger.error('Logout cleanup failed', err));
    }

    return { success: true, message: 'Logged out successfully' };
  }

  @Public()
  @UseGuards(RtGuard, RefreshRateLimitGuard) // Add rate limit to refresh
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @User() user: JwtPayload & { refreshToken: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const tokens = await this.authService.refreshTokens(user.sub, user.refreshToken);

      // Set new RT cookie
      res.cookie('refresh_token', tokens.refresh_token, {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/',
      });

      // Set new CSRF token
      this.csrfService.setTokenCookie(
        res,
        tokens.csrf_token,
        process.env.NODE_ENV === 'production',
      );

      return {
        access_token: tokens.access_token,
        csrf_token: tokens.csrf_token,
      };
    } catch (error) {
      if (error instanceof AuthException) throw error;
      throw new AuthException(
        AuthErrorCode.REFRESH_FAILED,
        HttpStatus.FORBIDDEN,
      );
    }
  }

  @UseGuards(AtGuard)
  @Get('me')
  @HttpCode(HttpStatus.OK)
  async getMe(@User('sub') userId: number): Promise<UserProfileResponse> {
    return this.userService.getUserProfile(userId);
  }

  @UseGuards(AtGuard, GlobalRateLimitGuard) // Rate limit password changes
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
  async googleAuth(@Req() req: Request) {
    // Passport will handle redirect to Google
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

    const result = await this.authService.validateOAuthUser({
      email: user.email,
      full_name: user.full_name,
      profile_avatar: user.profile_avatar,
      provider: 'google',
      providerId: '', // Will be filled from Passport
    });

    // Redirect to frontend with secure authorization code (no tokens in URL)
    const redirectUrl = new URL(
      `${process.env.FRONTEND_URL}/auth/oauth-callback`,
    );
    redirectUrl.searchParams.append('code', result.authorizationCode);
    redirectUrl.searchParams.append('provider', 'google');

    return res.redirect(redirectUrl.toString());
  }

  @Get('github')
  @Public()
  @UseGuards(GitHubAuthGuard)
  async githubAuth(@Req() req: Request) {
    // Passport will handle redirect to GitHub
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

    const result = await this.authService.validateOAuthUser({
      email: user.email,
      full_name: user.full_name,
      profile_avatar: user.profile_avatar,
      provider: 'github',
      providerId: '', // Will be filled from Passport
    });

    // Redirect to frontend with secure authorization code (no tokens in URL)
    const redirectUrl = new URL(
      `${process.env.FRONTEND_URL}/auth/oauth-callback`,
    );
    redirectUrl.searchParams.append('code', result.authorizationCode);
    redirectUrl.searchParams.append('provider', 'github');

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
