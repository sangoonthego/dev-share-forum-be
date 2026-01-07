import { SetMetadata } from '@nestjs/common';

/**
 * @Public() Decorator
 * 
 * Purpose: Mark a route as public (no authentication required)
 * 
 * Usage:
 * @Get('posts')
 * @Public()
 * async getPosts() { }
 * 
 * AtGuard checks this metadata via Reflector:
 * const isPublic = this.reflector.get<boolean>('isPublic', context.getHandler());
 * if (isPublic) return true;
 * 
 * Architecture:
 * - Metadata-based approach allows flexibility per-route
 * - AtGuard can be applied globally but respects @Public()
 * - Cleaner than maintaining separate public routes list
 */
export const Public = () => SetMetadata('isPublic', true);
