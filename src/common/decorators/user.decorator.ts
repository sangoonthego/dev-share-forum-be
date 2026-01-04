import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import type { JwtPayload } from 'src/auth/dto/auth.dto';

/**
 * @User() decorator - Extract user từ JWT payload
 * Usage: async logout(@User() user: JwtPayload)
 * 
 * Advantages:
 * - Type-safe (JwtPayload interface)
 * - Clean code (so sánh với req.user['sub'])
 * - Reusable across controllers
 */
export const User = createParamDecorator(
  (data: keyof JwtPayload | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request>();
    const user = request.user as JwtPayload;

    // Nếu data được cung cấp, trả về field cụ thể (e.g., @User('sub'))
    // Nếu không, trả về toàn bộ user object
    return data ? user?.[data] : user;
  },
);
