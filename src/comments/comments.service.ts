import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { RedisService } from 'src/redis/redis.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { NotificationsGateway } from 'src/notifications/notifications.gateway';
import { UserActivityService } from 'src/users/user-activity.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { CommentResponseDto, PaginatedCommentsResponseDto } from './dto/comment-response.dto';
import DOMPurify from 'isomorphic-dompurify';
import { CommentTreeUtility } from './utils/comment-tree.utility';

@Injectable()
export class CommentsService {
  private readonly CACHE_TTL = 3600; 
  private readonly MAX_COMMENT_DEPTH = 5; 
  private readonly logger = new Logger(CommentsService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
    private notificationsService: NotificationsService,
    private notificationsGateway: NotificationsGateway,
    private userActivityService: UserActivityService,
  ) {}

  async createComment(
    userId: number,
    dto: CreateCommentDto,
  ): Promise<CommentResponseDto> {
    const sanitizedContent = DOMPurify.sanitize(dto.content);

    const post = await this.prisma.posts.findUnique({
      where: { id: dto.postId },
      select: { id: true, author_id: true },
    });

    if (!post) {
      throw new NotFoundException(`Post with ID ${dto.postId} not found`);
    }

    let commentDepth = 0;
    let parentAuthorId: number | null = null;

    if (dto.parentId) {
      const parentComment = await this.prisma.comments.findUnique({
        where: { id: dto.parentId },
        select: {
          id: true,
          post_id: true,
          depth: true,
          author_id: true,
        },
      });

      if (!parentComment) {
        throw new NotFoundException(
          `Parent comment with ID ${dto.parentId} not found`,
        );
      }

      if (parentComment.post_id !== dto.postId) {
        throw new BadRequestException(
          'Parent comment must belong to the same post',
        );
      }

      commentDepth = Math.min(
        parentComment.depth + 1,
        this.MAX_COMMENT_DEPTH,
      );

      parentAuthorId = parentComment.author_id;
    }

    const comment = await this.prisma.comments.create({
      data: {
        content: sanitizedContent,
        post_id: dto.postId,
        author_id: userId,
        parent_id: dto.parentId || null,
        depth: commentDepth, // Enforces max depth
      },
      include: {
        author: {
          select: {
            id: true,
            email: true,
            full_name: true,
            profile_avatar: true,
            is_banned: true,
          },
        },
      },
    });

    await this._triggerCommentNotifications(
      comment,
      post,
      parentAuthorId,
      userId,
    );

    await this.userActivityService
      .logActivity(userId, 'COMMENT_CREATED', dto.postId, comment.id)
      .catch((err) =>
        console.error('Failed to log COMMENT_CREATED activity:', err),
      );

    await this._invalidateCommentCache(dto.postId);

    return this._formatComment(comment);
  }

  async getCommentsByPost(
    postId: number,
    includeReplies: boolean = true,
  ): Promise<PaginatedCommentsResponseDto> {
    // Validate post exists
    const post = await this.prisma.posts.findUnique({
      where: { id: postId },
      select: { id: true },
    });

    if (!post) {
      throw new NotFoundException(`Post with ID ${postId} not found`);
    }

    const cacheKey = `comments:post:${postId}:${includeReplies ? 'full' : 'root'}`;

    // Check Redis cache
    const cachedTree = await this.redis.get(cacheKey);
    if (cachedTree) {
      const parsed = JSON.parse(cachedTree);
      const total = CommentTreeUtility.flattenCommentTree(parsed).length;
      return {
        data: parsed,
        total,
      };
    }

    // Cache miss - query database
    let flatComments;

    if (includeReplies) {
      // Full tree: all comments
      flatComments = await this.prisma.comments.findMany({
        where: { post_id: postId },
        include: {
          author: {
            select: {
              id: true,
              email: true,
              full_name: true,
              profile_avatar: true,
              is_banned: true,
            },
          },
        },
        orderBy: { created_at: 'asc' },
      });
    } else {
      flatComments = await this.prisma.comments.findMany({
        where: {
          post_id: postId,
          depth: 0,
        },
        include: {
          author: {
            select: {
              id: true,
              email: true,
              full_name: true,
              profile_avatar: true,
              is_banned: true,
            },
          },
        },
        orderBy: { created_at: 'asc' },
      });
    }

    // Transform to tree
    const tree = CommentTreeUtility.buildCommentTree(
      flatComments.map((c) => ({
        id: c.id,
        content: c.content,
        post_id: c.post_id,
        author_id: c.author_id,
        parent_id: c.parent_id,
        depth: c.depth,
        likes: c.likes,
        dislikes: c.dislikes,
        deleted_at: (c as any).deleted_at || null,
        created_at: c.created_at,
        updated_at: c.updated_at,
        author: c.author,
      })),
    );

    const formattedTree = this._formatCommentTree(tree);

    const serialized = JSON.stringify(formattedTree);
    await this.redis.set(cacheKey, serialized, this.CACHE_TTL);

    const total = CommentTreeUtility.flattenCommentTree(formattedTree).length;

    return {
      data: formattedTree,
      total,
    };
  }

  async getCommentById(commentId: number): Promise<CommentResponseDto> {
    const comment = await this.prisma.comments.findUnique({
      where: { id: commentId },
      include: {
        author: {
          select: {
            id: true,
            email: true,
            full_name: true,
            profile_avatar: true,
            is_banned: true,
          },
        },
      },
    });

    if (!comment) {
      throw new NotFoundException(`Comment with ID ${commentId} not found`);
    }

    return this._formatComment(comment);
  }

  async getRepliesByCommentId(commentId: number): Promise<CommentResponseDto[]> {
    const replies = await this.prisma.comments.findMany({
      where: { parent_id: commentId },
      include: {
        author: {
          select: {
            id: true,
            email: true,
            full_name: true,
            profile_avatar: true,
            is_banned: true,
          },
        },
      },
      orderBy: { created_at: 'asc' },
    });

    return replies.map((r) => this._formatComment(r));
  }

  async likeComment(commentId: number): Promise<number> {
    const updated = await this.prisma.comments.update({
      where: { id: commentId },
      data: { likes: { increment: 1 } },
      select: { likes: true },
    });

    return updated.likes;
  }

  async dislikeComment(commentId: number): Promise<number> {
    const updated = await this.prisma.comments.update({
      where: { id: commentId },
      data: { dislikes: { increment: 1 } },
      select: { dislikes: true },
    });

    return updated.dislikes;
  }

  async updateComment(
    commentId: number,
    content: string,
  ): Promise<CommentResponseDto> {
    // 1. Fetch comment
    const existingComment = await this.prisma.comments.findUnique({
      where: { id: commentId },
      select: { post_id: true },
    });

    if (!existingComment) {
      throw new NotFoundException(`Comment with ID ${commentId} not found`);
    }

    // 2. Sanitize new content
    const sanitizedContent = DOMPurify.sanitize(content);

    // 3. Update atomically
    const updated = await this.prisma.comments.update({
      where: { id: commentId },
      data: {
        content: sanitizedContent,
        updated_at: new Date(),
      },
      include: {
        author: {
          select: {
            id: true,
            email: true,
            full_name: true,
            profile_avatar: true,
            is_banned: true,
          },
        },
      },
    });

    // 4. Invalidate cache
    await this._invalidateCommentCache(existingComment.post_id);

    return this._formatComment(updated);
  }

  async deleteComment(commentId: number): Promise<CommentResponseDto> {
    // 1. Fetch comment
    const existingComment = await this.prisma.comments.findUnique({
      where: { id: commentId },
      select: { post_id: true },
    });

    if (!existingComment) {
      throw new NotFoundException(`Comment with ID ${commentId} not found`);
    }

    // 2. Soft delete
    const deleted = await (this.prisma.comments.update as any)(
      {
        where: { id: commentId },
        data: {
          deleted_at: new Date(),
        },
        include: {
          author: {
            select: {
              id: true,
              email: true,
              full_name: true,
              profile_avatar: true,
              is_banned: true,
            },
          },
        },
      },
    ) as any;

    // 3. Invalidate cache
    await this._invalidateCommentCache(existingComment.post_id);

    return this._formatComment(deleted);
  }

  async hideAllCommentsByUser(userId: number): Promise<number> {
    const userComments = await this.prisma.comments.findMany({
      where: {
        author_id: userId,
        deleted_at: null,
      },
      select: { id: true, post_id: true },
    });

    const result = await this.prisma.comments.updateMany({
      where: { author_id: userId, deleted_at: null },
      data: { deleted_at: new Date() },
    });

    // Invalidate cache for all affected posts
    const postIds = new Set(userComments.map((c) => c.post_id));
    for (const postId of postIds) {
      await this._invalidateCommentCache(postId);
    }

    this.logger.log(
      `[BAN HANDLER] Hidden ${result.count} comments from user ${userId}`,
    );

    return result.count;
  }

  private _formatComment(comment: any): CommentResponseDto {
    const isDeleted = comment.deleted_at !== null;
    const isUserBanned = comment.author?.is_banned;

    let displayContent = comment.content;
    if (isDeleted && isUserBanned) {
      displayContent = '[Removed: User banned]';
    } else if (isDeleted) {
      displayContent = '[This comment has been removed]';
    } else if (isUserBanned) {
      displayContent = '[Comment from banned user]';
    }

    return {
      id: comment.id,
      content: displayContent,
      postId: comment.post_id,
      authorId: comment.author_id,
      author: {
        id: comment.author.id,
        email: comment.author.email,
        full_name: comment.author.full_name,
        profile_avatar: comment.author.profile_avatar,
      },
      parentId: comment.parent_id,
      depth: comment.depth || 0,
      likes: comment.likes || 0,
      dislikes: comment.dislikes || 0,
      isDeleted,
      isUserBanned,
      createdAt: comment.created_at,
      updatedAt: comment.updated_at,
      replies: [],
    };
  }

  private _formatCommentTree(tree: any[]): CommentResponseDto[] {
    return tree.map((comment) => {
      const isUserBanned = comment.author?.is_banned;
      const isDeleted = comment.isDeleted;

      let displayContent = comment.content;
      if (isDeleted && isUserBanned) {
        displayContent = '[Removed: User banned]';
      } else if (isDeleted) {
        displayContent = '[This comment has been removed]';
      } else if (isUserBanned) {
        displayContent = '[Comment from banned user]';
      }

      return {
        id: comment.id,
        content: displayContent,
        postId: comment.postId,
        authorId: comment.authorId,
        author: comment.author,
        parentId: comment.parentId,
        depth: comment.depth || 0,
        likes: comment.likes || 0,
        dislikes: comment.dislikes || 0,
        isDeleted: comment.isDeleted,
        isUserBanned,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
        replies:
          comment.replies.length > 0
            ? this._formatCommentTree(comment.replies)
            : [],
      };
    });
  }

  private async _invalidateCommentCache(postId: number): Promise<void> {
    await this.redis.del(`comments:post:${postId}:full`);
    await this.redis.del(`comments:post:${postId}:root`);
  }

  private async _triggerCommentNotifications(
    comment: any,
    post: any,
    parentAuthorId: number | null,
    userId: number,
  ): Promise<void> {
    try {
      if (!comment || !comment.author) {
        this.logger.warn(
          `[NOTIFICATION] Skipping: comment or author is undefined`,
        );
        return;
      }

      const commenterName = comment.author.full_name || 'Someone';

      // Notify post author if different from commenter
      if (post.author_id !== userId) {
        const postNotif =
          await this.notificationsService.createNotification({
            user_id: post.author_id,
            title: 'New comment on your post',
            message: `${commenterName} commented on your post`,
            type: 'post_comment',
            related_post_id: post.id,
            related_comment_id: comment.id,
            related_user_id: userId,
          });

        // Ensure null-safety: convert undefined to null
        await this.notificationsGateway.notifyUser(post.author_id, {
          id: postNotif.id,
          title: postNotif.title,
          message: postNotif.message,
          type: postNotif.type,
          relatedPostId: postNotif.relatedPostId ?? null,
          relatedCommentId: postNotif.relatedCommentId ?? null,
          relatedUserId: postNotif.relatedUserId ?? null,
          createdAt: postNotif.createdAt,
          timestamp: Date.now(),
        });

        this.logger.debug(
          `[NOTIFICATION] Post author ${post.author_id} notified of new comment`,
        );
      }

      // Notify parent comment author if reply
      if (parentAuthorId && parentAuthorId !== userId) {
        const replyNotif =
          await this.notificationsService.createNotification({
            user_id: parentAuthorId,
            title: 'New reply to your comment',
            message: `${commenterName} replied to your comment`,
            type: 'comment_reply',
            related_post_id: post.id,
            related_comment_id: comment.id,
            related_user_id: userId,
          });

        await this.notificationsGateway.notifyUser(parentAuthorId, {
          id: replyNotif.id,
          title: replyNotif.title,
          message: replyNotif.message,
          type: replyNotif.type,
          relatedPostId: replyNotif.relatedPostId ?? null,
          relatedCommentId: replyNotif.relatedCommentId ?? null,
          relatedUserId: replyNotif.relatedUserId ?? null,
          createdAt: replyNotif.createdAt,
          timestamp: Date.now(),
        });

        this.logger.debug(
          `[NOTIFICATION] Comment author ${parentAuthorId} notified of reply`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `[NOTIFICATION ERROR] Failed to trigger notifications: ${error.message}`,
      );
    }
  }
}
