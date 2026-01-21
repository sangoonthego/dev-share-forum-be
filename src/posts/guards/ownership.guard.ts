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

@Injectable()
export class OwnershipGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = (request.user as JwtPayload) || null;
    const postId = request.params?.id;

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    if (!postId || isNaN(Number(postId))) {
      throw new BadRequestException('Invalid post ID');
    }

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

    if (post.deleted_at !== null && user.role !== 'ADMIN') {
      throw new NotFoundException('Post not found');
    }

    const isOwner = post.author_id === user.sub;
    const isAdmin = user.role === 'ADMIN';

    if (!isOwner && !isAdmin) {
      throw new ForbiddenException('You can only manage your own posts');
    }

    (request as any).post = post;

    return true;
  }
}
