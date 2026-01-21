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

@Controller('comments')
export class CommentsController {
  constructor(private commentsService: CommentsService) {}

  @Post('/posts/:postId/comments')
  @UseGuards(AtGuard)
  @Throttle({ default: { limit: 5, ttl: 300 } }) 
  @HttpCode(HttpStatus.CREATED)
  async createComment(
    @Param('postId') postId: string,
    @Body() dto: CreateCommentDto,
    @Req() req: Request,
  ): Promise<CommentResponseDto> {
    const user = req.user as JwtPayload;
    const postIdNumber = Number(postId);

    if (isNaN(postIdNumber)) {
      throw new Error('Invalid post ID format');
    }

    if (dto.postId !== postIdNumber) {
      throw new Error('Post ID in body must match route parameter');
    }

    return this.commentsService.createComment(user.sub, dto);
  }

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
