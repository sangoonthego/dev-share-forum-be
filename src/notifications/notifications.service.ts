import {
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateNotificationDto, NotificationResponseDto } from './dto/notification.dto';

/**
 * NotificationsService - Manages notification persistence and retrieval
 *
 * **Features:**
 * - Create notifications (called by comments service)
 * - Retrieve user notifications with pagination
 * - Mark as read (single or bulk)
 * - Cleanup old notifications (archive after 30 days)
 *
 * **Lifecycle:**
 * 1. Comments service creates notification via createNotification()
 * 2. Service saves to PostgreSQL
 * 3. Service emits WebSocket event via NotificationsGateway
 * 4. Client receives real-time notification
 * 5. User marks as read (optional)
 * 6. Notifications auto-archive after 30 days
 *
 * **Database:** PostgreSQL (persistent storage)
 * **Real-time:** WebSockets (instant delivery to online users)
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Create notification and save to database
   *
   * Called by: CommentsService on create/reply
   * Returned: This method doesn't emit WebSocket (gateway does)
   *
   * @param dto - CreateNotificationDto
   * @returns Saved notification
   */
  async createNotification(
    dto: CreateNotificationDto,
  ): Promise<NotificationResponseDto> {
    const notification = await this.prisma.notifications.create({
      data: {
        user_id: dto.user_id,
        title: dto.title,
        message: dto.message,
        type: dto.type,
        related_comment_id: dto.related_comment_id,
        related_post_id: dto.related_post_id,
        related_user_id: dto.related_user_id,
        is_read: false,
      },
    });

    return this._formatNotification(notification);
  }

  /**
   * Get unread notifications for user (with pagination)
   *
   * @param userId - User ID
   * @param limit - Max results (default: 50)
   * @param skip - Pagination offset (default: 0)
   * @returns Paginated notifications (newest first)
   */
  async getUnreadNotifications(
    userId: number,
    limit: number = 50,
    skip: number = 0,
  ): Promise<{
    data: NotificationResponseDto[];
    total: number;
    unreadCount: number;
  }> {
    // Get unread notifications
    const [notifications, total, unreadCount] = await Promise.all([
      this.prisma.notifications.findMany({
        where: {
          user_id: userId,
          is_read: false,
        },
        orderBy: { created_at: 'desc' },
        take: limit,
        skip,
      }),
      this.prisma.notifications.count({
        where: {
          user_id: userId,
          is_read: false,
        },
      }),
      this.prisma.notifications.count({
        where: {
          user_id: userId,
          is_read: false,
        },
      }),
    ]);

    return {
      data: notifications.map((n) => this._formatNotification(n)),
      total,
      unreadCount,
    };
  }

  /**
   * Get all notifications for user (with pagination)
   *
   * @param userId - User ID
   * @param limit - Max results (default: 100)
   * @param skip - Pagination offset (default: 0)
   * @returns Paginated notifications (newest first)
   */
  async getAllNotifications(
    userId: number,
    limit: number = 100,
    skip: number = 0,
  ): Promise<{
    data: NotificationResponseDto[];
    total: number;
  }> {
    const [notifications, total] = await Promise.all([
      this.prisma.notifications.findMany({
        where: { user_id: userId },
        orderBy: { created_at: 'desc' },
        take: limit,
        skip,
      }),
      this.prisma.notifications.count({
        where: { user_id: userId },
      }),
    ]);

    return {
      data: notifications.map((n) => this._formatNotification(n)),
      total,
    };
  }

  /**
   * Mark single notification as read
   *
   * @param notificationId - Notification ID
   * @param userId - User ID (for authorization)
   * @returns Updated notification
   */
  async markAsRead(
    notificationId: number,
    userId: number,
  ): Promise<NotificationResponseDto> {
    // Verify ownership
    const notification = await this.prisma.notifications.findUnique({
      where: { id: notificationId },
    });

    if (!notification) {
      throw new NotFoundException(
        `Notification with ID ${notificationId} not found`,
      );
    }

    if (notification.user_id !== userId) {
      throw new NotFoundException('Notification not found');
    }

    const updated = await this.prisma.notifications.update({
      where: { id: notificationId },
      data: { is_read: true },
    });

    return this._formatNotification(updated);
  }

  /**
   * Mark all notifications as read
   *
   * @param userId - User ID
   * @returns Count of updated notifications
   */
  async markAllAsRead(userId: number): Promise<number> {
    const result = await this.prisma.notifications.updateMany({
      where: {
        user_id: userId,
        is_read: false,
      },
      data: { is_read: true },
    });

    return result.count;
  }

  /**
   * Get notification by ID
   *
   * @param notificationId - Notification ID
   * @param userId - User ID (for authorization)
   * @returns Notification details
   */
  async getNotificationById(
    notificationId: number,
    userId: number,
  ): Promise<NotificationResponseDto> {
    const notification = await this.prisma.notifications.findUnique({
      where: { id: notificationId },
    });

    if (!notification || notification.user_id !== userId) {
      throw new NotFoundException('Notification not found');
    }

    return this._formatNotification(notification);
  }

  /**
   * Cleanup: Delete notifications older than 30 days
   *
   * Called by: Cron job or manual trigger
   * Purpose: Archive old data, reduce database size
   *
   * @returns Count of deleted notifications
   */
  async cleanupOldNotifications(): Promise<number> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const result = await this.prisma.notifications.deleteMany({
      where: {
        created_at: {
          lt: thirtyDaysAgo,
        },
      },
    });

    this.logger.log(
      `[CLEANUP] Deleted ${result.count} notifications older than 30 days`,
    );

    return result.count;
  }

  /**
   * Get unread count for user (lightweight query for badge)
   *
   * @param userId - User ID
   * @returns Unread notification count
   */
  async getUnreadCount(userId: number): Promise<number> {
    return this.prisma.notifications.count({
      where: {
        user_id: userId,
        is_read: false,
      },
    });
  }

  /**
   * Format database record to API response
   */
  private _formatNotification(notification: any): NotificationResponseDto {
    return {
      id: notification.id,
      userId: notification.user_id,
      title: notification.title,
      message: notification.message,
      type: notification.type,
      relatedCommentId: notification.related_comment_id,
      relatedPostId: notification.related_post_id,
      relatedUserId: notification.related_user_id,
      isRead: notification.is_read,
      createdAt: notification.created_at,
    };
  }
}
