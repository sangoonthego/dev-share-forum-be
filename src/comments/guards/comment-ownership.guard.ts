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

@Injectable()
export class CommentOwnershipGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = (request.user as JwtPayload) || null;
    const commentId = request.params?.id;
    const method = request.method;

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    if (!commentId || isNaN(Number(commentId))) {
      throw new BadRequestException('Invalid comment ID');
    }

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

    return true;
  }

  private _enforceUpdateAuthorization(
    isCommentAuthor: boolean,
    isAdmin: boolean,
    deletedAt: Date | null,
  ): boolean {
    if (deletedAt !== null) {
      throw new ForbiddenException('Cannot update a deleted comment');
    }

    if (!isCommentAuthor && !isAdmin) {
      throw new ForbiddenException(
        'Only the comment author or admin can update this comment',
      );
    }

    return true;
  }

  private _enforceDeleteAuthorization(
    isCommentAuthor: boolean,
    isPostAuthor: boolean,
    isAdmin: boolean,
    deletedAt: Date | null,
  ): boolean {
    if (deletedAt !== null) {
      throw new ForbiddenException('Comment is already deleted');
    }

    if (!isCommentAuthor && !isPostAuthor && !isAdmin) {
      throw new ForbiddenException(
        'Only the comment author, post author, or admin can delete this comment',
      );
    }

    return true;
  }
}
