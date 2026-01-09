/**
 * CreateNotificationDto - Input for creating notifications
 * Typically called internally by service, not from API
 */
export class CreateNotificationDto {
  user_id: number;
  title: string; // "New reply to your comment"
  message: string; // "John replied: 'Great post!'"
  type: 'comment_reply' | 'post_comment' | 'system';
  related_comment_id?: number | null; // Can be null
  related_post_id?: number | null; // Can be null
  related_user_id?: number | null; // Can be null
}

/**
 * NotificationResponseDto - API response format
 */
export class NotificationResponseDto {
  id: number;
  userId: number;
  title: string;
  message: string;
  type: string;
  relatedCommentId?: number | null; // Can be null from Prisma
  relatedPostId?: number | null; // Can be null from Prisma
  relatedUserId?: number | null; // Can be null from Prisma
  isRead: boolean;
  createdAt: Date;
}

/**
 * WebSocket notification event - sent to connected clients
 * Push format for real-time delivery
 */
export class WebSocketNotificationDto {
  id: number;
  title: string;
  message: string;
  type: string;
  relatedCommentId?: number | null; // Can be null from Prisma
  relatedPostId?: number | null; // Can be null from Prisma
  relatedUserId?: number | null; // Can be null from Prisma
  createdAt: Date;
  timestamp?: number; // Auto-added by gateway, optional in DTO
}

/**
 * Mark notification as read
 */
export class MarkNotificationAsReadDto {
  notificationId: number;
}

/**
 * Mark all notifications as read
 */
export class MarkAllNotificationsAsReadDto {
  userId: number;
}
