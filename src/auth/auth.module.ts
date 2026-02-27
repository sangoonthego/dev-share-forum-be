import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './services/auth.service';
import { TokenService } from './services/token.service';
import { LoginService } from './services/login.service';
import { RegisterService } from './services/register.service';
import { UserService } from './services/user.service';
import { LoginAuditService } from './services/login-audit.service';
import { ChangePasswordService } from './services/change-password.service';
import { CsrfService } from './services/csrf.service';
import { AtStrategy } from './strategies/at.strategy';
import { RtStrategy } from './strategies/rt.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { GitHubStrategy } from './strategies/github.strategy';
import { LoggerService } from 'src/common/logger/logger.service';

const oauthStrategies: any[] = [];
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  oauthStrategies.push(GoogleStrategy);
}
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
  oauthStrategies.push(GitHubStrategy);
}

@Module({
  imports: [
    PassportModule, 
    JwtModule.register({}),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    LoginService,
    RegisterService,
    UserService,
    LoginAuditService,
    ChangePasswordService,
    CsrfService,
    AtStrategy, 
    RtStrategy,
    LoggerService,
    ...oauthStrategies,
  ],
  exports: [UserService, LoginAuditService], 
})
export class AuthModule {}