import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';

@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    
    // Skip CSRF check for GET, HEAD, OPTIONS
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      return true;
    }

    const headerCsrf = request.headers['x-csrf-token'];
    const user = request.user as any;
    const payloadCsrf = user?.csrf_token;

    if (!headerCsrf || !payloadCsrf) {
        throw new ForbiddenException('CSRF token missing');
    }

    if (headerCsrf !== payloadCsrf) {
        throw new ForbiddenException('CSRF token mismatch');
    }

    return true;
  }
}
