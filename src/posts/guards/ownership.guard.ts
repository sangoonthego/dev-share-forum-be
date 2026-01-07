import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from 'src/prisma/prisma.service';
import type { JwtPayload } from 'src/auth/dto/auth.dto';

/**
 * Ownership Guard - Ensure user owns the resource or is ADMIN
 * 
 * Purpose:
 * - Verify that the authenticated user is the post author OR has ADMIN role
 * - Prevent users from editing/deleting other users' posts
 * - Allow admins to manage any post
 * - Prevent access to soft-deleted posts unless user is ADMIN
 * 
 * Usage:
 * @Patch(':id')
 * @UseGuards(AtGuard, OwnershipGuard)
 * async updatePost(@Param('id') id: string, @Body() dto: UpdatePostDto) { }
 * 
 * Architecture:
 * - Operates on resource ID from route params
 * - Fetches resource to verify ownership
 * - Attaches resource to request for controller use
 * - Supports role-based override (ADMIN)
 * - Blocks access to soft-deleted posts for non-ADMIN users
 * 
 * Security Notes:
 * - Must be used AFTER AtGuard (requires authenticated user)
 * - Verifies actual ownership, not just user ID match
 * - Admin bypass is intentional for moderation
 * - Soft-deleted posts are inaccessible to non-ADMIN users
 */
@Injectable()
export class OwnershipGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = (request.user as JwtPayload) || null;
    const postId = request.params?.id;

    // Validation
    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    if (!postId || isNaN(Number(postId))) {
      throw new BadRequestException('Invalid post ID');
    }

    // Fetch post to verify ownership
    const post = await this.prisma.posts.findUnique({
      where: { id: Number(postId) },
      select: {
        id: true,
        author_id: true,
        deleted_at: true,
        author: {
          select: {
            id: true,
            email: true,
            role: true,
          },
        },
      },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    // Check if post is soft-deleted and user is not ADMIN
    if (post.deleted_at !== null && user.role !== 'ADMIN') {
      throw new NotFoundException('Post not found');
    }

    // Check ownership: author OR admin
    const isOwner = post.author_id === user.sub;
    const isAdmin = user.role === 'ADMIN';

    if (!isOwner && !isAdmin) {
      throw new ForbiddenException('You can only manage your own posts');
    }

    // Attach post to request for controller use
    (request as any).post = post;

    return true;
  }
}
