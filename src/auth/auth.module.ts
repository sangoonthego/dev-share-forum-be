import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './services/auth.service';
import { TokenService } from './services/token.service';
import { LoginService } from './services/login.service';
import { RegisterService } from './services/register.service';
import { UserService } from './services/user.service';
import { LoginAuditService } from './services/login-audit.service';
import { ChangePasswordService } from './services/change-password.service';
import { AtStrategy } from './strategies/at.strategy';
import { RtStrategy } from './strategies/rt.strategy';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    LoginService,
    RegisterService,
    UserService,
    LoginAuditService,
    ChangePasswordService,
    AtStrategy, 
    RtStrategy,
  ],
  exports: [UserService, LoginAuditService], // Export for other modules
})
export class AuthModule {}