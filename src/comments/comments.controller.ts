import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { CommentsService } from './comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { CommentResponseDto, PaginatedCommentsResponseDto } from './dto/comment-response.dto';
import { AtGuard } from 'src/common/guards/at.guard';
import { CommentOwnershipGuard } from './guards/comment-ownership.guard';
import { User } from 'src/common/decorators/user.decorator';
import { Public } from 'src/common/decorators/public.decorator';
import type { JwtPayload } from 'src/auth/dto/auth.dto';

/**
 * CommentsController - High-performance nested comment management
 * 
 * Features:
 * - Public read endpoints (GET)
 * - Authenticated write endpoints (POST, PATCH, DELETE)
 * - Owner verification (CommentOwnershipGuard)
 * - Post author override for DELETE (moderation)
 * - Admin override for all operations
 * - Rate limiting: 5 comments per 5 minutes per user
 * - Hierarchical comment tree structure with soft delete support
 * 
 * Security:
 * - @Public() for read operations
 * - @UseGuards(AtGuard) for authenticated operations
 * - @UseGuards(CommentOwnershipGuard) for authorization verification
 * - @Throttle for rate limiting on create operations
 * 
 * Rate Limiting Strategy:
 * - CREATE: 5 comments per 5 minutes per user (prevents spam)
 * - READ: No limit (public data)
 * - UPDATE/DELETE: No limit but guarded by ownership
 * 
 * Endpoints:
 * POST   /posts/:postId/comments           - Create comment
 * GET    /posts/:postId/comments           - Get all comments as tree
 * GET    /comments/:id                     - Get single comment
 * PATCH  /comments/:id                     - Update comment
 * DELETE /comments/:id                     - Soft delete comment
 */
@Controller('comments')
export class CommentsController {
  constructor(private commentsService: CommentsService) {}

  /**
   * POST /posts/:postId/comments - Create new comment
   * 
   * Rate Limiting: 5 comments per 5 minutes per user
   * (Prevents spam/abuse)
   * 
   * Requires: Authentication (JWT)
   * Body: CreateCommentDto
   * 
   * Workflow:
   * 1. Throttler validates rate limit
   * 2. Extract userId from JWT
   * 3. Service validates post exists, parent exists (if provided)
   * 4. Service sanitizes content and creates comment atomically
   * 5. Service invalidates Redis cache
   * 6. Return created comment with author details
   * 
   * Success: 201 Created
   * Errors:
   * - 400: Invalid input (validation error)
   * - 404: Post or parent comment not found
   * - 429: Rate limit exceeded
   * 
   * @param postId - Post ID from route params
   * @param dto - CreateCommentDto (content, postId, parentId)
   * @param req - Express request (contains user from JWT)
   * @returns Created comment
   */
  @Post('/posts/:postId/comments')
  @UseGuards(AtGuard)
  @Throttle({ default: { limit: 5, ttl: 300 } }) // 5 comments per 5 minutes
  @HttpCode(HttpStatus.CREATED)
  async createComment(
    @Param('postId') postId: string,
    @Body() dto: CreateCommentDto,
    @Req() req: Request,
  ): Promise<CommentResponseDto> {
    const user = req.user as JwtPayload;
    const postIdNumber = Number(postId);

    // Validate postId from route
    if (isNaN(postIdNumber)) {
      throw new Error('Invalid post ID format');
    }

    // Ensure postId in DTO matches route
    if (dto.postId !== postIdNumber) {
      throw new Error('Post ID in body must match route parameter');
    }

    return this.commentsService.createComment(user.sub, dto);
  }

  /**
   * GET /posts/:postId/comments - Get all comments for a post
   * 
   * Returns: Hierarchical comment tree
   * - Root level comments
   * - Each comment has nested replies array
   * - Soft-deleted comments show placeholder, children preserved
   * 
   * Caching:
   * - Redis caches processed tree for 1 hour
   * - Tree is rebuilt on first access or after invalidation
   * 
   * No authentication required (read-only public data)
   * 
   * Success: 200 OK
   * Errors:
   * - 404: Post not found
   * 
   * @param postId - Post ID from route params
   * @returns Hierarchical comment tree with total count
   */
  @Get('/posts/:postId/comments')
  @Public()
  @HttpCode(HttpStatus.OK)
  async getCommentsByPost(
    @Param('postId') postId: string,
  ): Promise<PaginatedCommentsResponseDto> {
    const postIdNumber = Number(postId);

    if (isNaN(postIdNumber)) {
      throw new Error('Invalid post ID format');
    }

    return this.commentsService.getCommentsByPost(postIdNumber);
  }

  /**
   * GET /comments/:id - Get single comment details
   * 
   * Returns: Comment with author info
   * - Does not include nested replies (use getCommentsByPost for tree)
   * 
   * No authentication required
   * 
   * Success: 200 OK
   * Errors:
   * - 404: Comment not found
   * 
   * @param id - Comment ID from route params
   * @returns Comment details
   */
  @Get(':id')
  @Public()
  @HttpCode(HttpStatus.OK)
  async getComment(@Param('id') id: string): Promise<CommentResponseDto> {
    const commentId = Number(id);

    if (isNaN(commentId)) {
      throw new Error('Invalid comment ID format');
    }

    return this.commentsService.getCommentById(commentId);
  }

  /**
   * PATCH /comments/:id - Update comment
   * 
   * Authorization: Only comment author or admin
   * - CommentOwnershipGuard enforces this
   * 
   * Rate Limiting: None (guarded by ownership)
   * 
   * Workflow:
   * 1. AtGuard verifies authentication
   * 2. CommentOwnershipGuard verifies authorization
   * 3. Service validates comment exists
   * 4. Service sanitizes new content
   * 5. Service updates atomically
   * 6. Service invalidates Redis cache
   * 
   * Success: 200 OK
   * Errors:
   * - 401: Not authenticated
   * - 403: Not authorized (not author or admin)
   * - 404: Comment not found
   * 
   * @param id - Comment ID from route params
   * @param dto - Update DTO (contains content field)
   * @param req - Express request
   * @returns Updated comment
   */
  @Patch(':id')
  @UseGuards(AtGuard, CommentOwnershipGuard)
  @HttpCode(HttpStatus.OK)
  async updateComment(
    @Param('id') id: string,
    @Body() dto: { content: string },
    @Req() req: Request,
  ): Promise<CommentResponseDto> {
    const commentId = Number(id);

    if (isNaN(commentId)) {
      throw new Error('Invalid comment ID format');
    }

    return this.commentsService.updateComment(commentId, dto.content);
  }

  /**
   * DELETE /comments/:id - Soft delete comment
   * 
   * Authorization: Comment author, post author, or admin
   * - CommentOwnershipGuard enforces this
   * 
   * Soft Delete:
   * - Comment content replaced with "This comment has been removed"
   * - Child replies preserved (don't become orphans)
   * - Maintains conversation context
   * - isDeleted flag set to true
   * 
   * Rate Limiting: None
   * 
   * Workflow:
   * 1. AtGuard verifies authentication
   * 2. CommentOwnershipGuard verifies authorization
   * 3. Service marks comment with deleted_at timestamp
   * 4. Service invalidates Redis cache
   * 
   * Success: 200 OK with deleted comment
   * Errors:
   * - 401: Not authenticated
   * - 403: Not authorized (not author, post author, or admin)
   * - 404: Comment not found
   * 
   * @param id - Comment ID from route params
   * @param req - Express request
   * @returns Soft-deleted comment
   */
  @Delete(':id')
  @UseGuards(AtGuard, CommentOwnershipGuard)
  @HttpCode(HttpStatus.OK)
  async deleteComment(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<CommentResponseDto> {
    const commentId = Number(id);

    if (isNaN(commentId)) {
      throw new Error('Invalid comment ID format');
    }

    return this.commentsService.deleteComment(commentId);
  }
}
