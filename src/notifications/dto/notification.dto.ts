export class CreateNotificationDto {
  user_id: number;
  title: string; 
  message: string; 
  type: 'comment_reply' | 'post_comment' | 'system';
  related_comment_id?: number | null; 
  related_post_id?: number | null; 
  related_user_id?: number | null;
}

export class NotificationResponseDto {
  id: number;
  userId: number;
  title: string;
  message: string;
  type: string;
  relatedCommentId?: number | null; 
  relatedPostId?: number | null; 
  relatedUserId?: number | null; 
  isRead: boolean;
  createdAt: Date;
}

export class WebSocketNotificationDto {
  id: number;
  title: string;
  message: string;
  type: string;
  relatedCommentId?: number | null; 
  relatedPostId?: number | null; 
  relatedUserId?: number | null; 
  createdAt: Date;
  timestamp?: number; 
}

export class MarkNotificationAsReadDto {
  notificationId: number;
}

export class MarkAllNotificationsAsReadDto {
  userId: number;
}
