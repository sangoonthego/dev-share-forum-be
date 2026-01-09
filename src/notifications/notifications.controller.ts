import {
  Controller,
  Get,
  Patch,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { NotificationsService } from './notifications.service';
import { NotificationResponseDto } from './dto/notification.dto';
import { AtGuard } from 'src/common/guards/at.guard';
import type { JwtPayload } from 'src/auth/dto/auth.dto';

/**
 * NotificationsController - Notification retrieval and management endpoints
 *
 * **Endpoints:**
 * GET  /notifications/unread      - Get unread notifications
 * GET  /notifications             - Get all notifications
 * GET  /notifications/:id         - Get single notification
 * GET  /notifications/count/unread - Get unread count
 * PATCH /notifications/:id/read   - Mark as read
 * PATCH /notifications/read/all   - Mark all as read
 *
 * **Security:**
 * - All endpoints require JWT authentication (@UseGuards(AtGuard))
 * - Users can only access their own notifications
 * - Service verifies ownership
 *
 * **Real-time Delivery:**
 * - WebSocket gateway (notifications.gateway.ts) handles instant delivery
 * - REST endpoints for background fetching and status checks
 */
@Controller('notifications')
@UseGuards(AtGuard)
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

  /**
   * GET /notifications/unread
   *
   * Get unread notifications with pagination
   *
   * Query Params:
   * - limit: max results (default: 50)
   * - skip: pagination offset (default: 0)
   *
   * Returns: Paginated unread notifications + unread count
   */
  @Get('unread')
  @HttpCode(HttpStatus.OK)
  async getUnreadNotifications(
    @Req() req: Request,
    @Query('limit') limit?: string,
    @Query('skip') skip?: string,
  ) {
    const user = req.user as JwtPayload;
    const limitNum = Math.min(Number(limit) || 50, 100);
    const skipNum = Number(skip) || 0;

    return this.notificationsService.getUnreadNotifications(
      user.sub,
      limitNum,
      skipNum,
    );
  }

  /**
   * GET /notifications
   *
   * Get all notifications with pagination
   *
   * Query Params:
   * - limit: max results (default: 100)
   * - skip: pagination offset (default: 0)
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  async getAllNotifications(
    @Req() req: Request,
    @Query('limit') limit?: string,
    @Query('skip') skip?: string,
  ) {
    const user = req.user as JwtPayload;
    const limitNum = Math.min(Number(limit) || 100, 100);
    const skipNum = Number(skip) || 0;

    return this.notificationsService.getAllNotifications(
      user.sub,
      limitNum,
      skipNum,
    );
  }

  /**
   * GET /notifications/count/unread
   *
   * Lightweight endpoint for notification badge
   * Returns only count, not full notifications
   */
  @Get('count/unread')
  @HttpCode(HttpStatus.OK)
  async getUnreadCount(
    @Req() req: Request,
  ) {
    const user = req.user as JwtPayload;
    const unreadCount = await this.notificationsService.getUnreadCount(user.sub);
    return { unreadCount };
  }

  /**
   * GET /notifications/:id
   *
   * Get single notification by ID
   * Must be owner
   */
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async getNotification(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<NotificationResponseDto> {
    const user = req.user as JwtPayload;
    return this.notificationsService.getNotificationById(Number(id), user.sub);
  }

  /**
   * PATCH /notifications/:id/read
   *
   * Mark single notification as read
   */
  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  async markAsRead(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<NotificationResponseDto> {
    const user = req.user as JwtPayload;
    return this.notificationsService.markAsRead(Number(id), user.sub);
  }

  /**
   * PATCH /notifications/read/all
   *
   * Mark all notifications as read
   */
  @Patch('read/all')
  @HttpCode(HttpStatus.OK)
  async markAllAsRead(
    @Req() req: Request,
  ) {
    const user = req.user as JwtPayload;
    const count = await this.notificationsService.markAllAsRead(user.sub);
    return { count, message: `${count} notifications marked as read` };
  }
}
