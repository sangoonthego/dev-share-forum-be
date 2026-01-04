import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
// Import bình thường để sử dụng type bên trong logic hàm
import { JwtPayload } from '../dto/auth.dto';

@Injectable()
export class AtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      // Đảm bảo secret luôn là string để thỏa mãn yêu cầu của Passport
      secretOrKey: process.env.JWT_AT_SECRET || 'at-secret-fallback',
    });
  }

  validate(payload: any): JwtPayload {
    return payload as JwtPayload;
  }
}