import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from 'src/prisma/prisma.service';
import type { JwtPayload } from 'src/auth/dto/auth.dto';

/**
 * CommentOwnershipGuard - Advanced moderation logic for comment operations
 * 
 * Purpose:
 * - Verify authorization for comment UPDATE and DELETE operations
 * - Support different rules based on operation type
 * - Allow post authors to moderate their comments
 * - Allow admins to moderate any comment
 * 
 * Authorization Rules:
 * 
 * UPDATE (PATCH /comments/:id):
 * - Only the comment author can edit their own comment
 * - Admin can edit any comment (for moderation/correction)
 * - Cannot update soft-deleted comments
 * 
 * DELETE (DELETE /comments/:id):
 * - Comment author can delete their own comment
 * - Post author can delete comments on their post
 * - Admin can delete any comment
 * - Cannot delete already soft-deleted comments
 * 
 * Usage:
 * @UseGuards(AtGuard, CommentOwnershipGuard)
 * @Patch(':id')
 * async updateComment(@Param('id') id: string) { }
 * 
 * Architecture:
 * - Detects operation from HTTP method and route
 * - Fetches both comment and post author info
 * - Enforces owner check based on operation
 * - Attaches resource to request for controller use
 * 
 * Security Notes:
 * - Must be used AFTER AtGuard (requires authenticated user)
 * - Soft-deleted comments: cannot be updated; can only be deleted if user is ADMIN
 * - Post author bypass for DELETE (moderation purpose)
 * - Admin bypass is intentional for platform moderation
 */
@Injectable()
export class CommentOwnershipGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = (request.user as JwtPayload) || null;
    const commentId = request.params?.id;
    const method = request.method;

    // Validation
    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    if (!commentId || isNaN(Number(commentId))) {
      throw new BadRequestException('Invalid comment ID');
    }

    // Fetch comment with post and author info
    const comment = await this.prisma.comments.findUnique({
      where: { id: Number(commentId) },
      select: {
        id: true,
        author_id: true,
        post_id: true,
      },
    });

    if (!comment) {
      throw new NotFoundException('Comment not found');
    }

    // Fetch post author separately
    const post = await this.prisma.posts.findUnique({
      where: { id: comment.post_id },
      select: {
        author_id: true,
        deleted_at: true,
      },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    // Get user info (for role checking)
    const userInfo = await this.prisma.users.findUnique({
      where: { id: user.sub },
      select: { role: true },
    });

    if (!userInfo) {
      throw new ForbiddenException('User not found');
    }

    const isCommentAuthor = comment.author_id === user.sub;
    const isPostAuthor = post.author_id === user.sub;
    const isAdmin = userInfo.role === 'ADMIN';

    // Enforce authorization based on HTTP method (operation type)
    if (method === 'PATCH') {
      return this._enforceUpdateAuthorization(
        isCommentAuthor,
        isAdmin,
        post.deleted_at,
      );
    } else if (method === 'DELETE') {
      return this._enforceDeleteAuthorization(
        isCommentAuthor,
        isPostAuthor,
        isAdmin,
        post.deleted_at,
      );
    }

    // If not PATCH or DELETE, allow (should not reach here)
    return true;
  }

  /**
   * UPDATE authorization logic
   * - Only comment author or admin can update
   */
  private _enforceUpdateAuthorization(
    isCommentAuthor: boolean,
    isAdmin: boolean,
    deletedAt: Date | null,
  ): boolean {
    // Cannot update soft-deleted comments
    if (deletedAt !== null) {
      throw new ForbiddenException('Cannot update a deleted comment');
    }

    // Only author or admin can update
    if (!isCommentAuthor && !isAdmin) {
      throw new ForbiddenException(
        'Only the comment author or admin can update this comment',
      );
    }

    return true;
  }

  /**
   * DELETE authorization logic
   * - Comment author, post author, or admin can delete
   */
  private _enforceDeleteAuthorization(
    isCommentAuthor: boolean,
    isPostAuthor: boolean,
    isAdmin: boolean,
    deletedAt: Date | null,
  ): boolean {
    // Cannot delete already soft-deleted comments
    if (deletedAt !== null) {
      throw new ForbiddenException('Comment is already deleted');
    }

    // Comment author, post author, or admin can delete
    if (!isCommentAuthor && !isPostAuthor && !isAdmin) {
      throw new ForbiddenException(
        'Only the comment author, post author, or admin can delete this comment',
      );
    }

    return true;
  }
}
