import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { NotificationsService } from './notifications.service';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsController } from './notifications.controller';

/**
 * NotificationsModule - Real-time notification system
 *
 * **Components:**
 * - NotificationsService: Persistence layer (PostgreSQL)
 * - NotificationsGateway: WebSocket real-time delivery (Socket.IO)
 * - NotificationsController: REST API for fetching/managing notifications
 *
 * **Exports:**
 * - NotificationsService: For CommentsModule to trigger notifications
 * - NotificationsGateway: For dependency injection in other services
 *
 * **Integration Points:**
 * - CommentsModule → calls NotificationsService to create notification
 * - CommentsModule → calls NotificationsGateway to push real-time update
 * - AuthModule → calls CommentsService.hideAllCommentsByUser on ban
 *
 * **WebSocket Configuration:**
 * - Namespace: /notifications
 * - Auth: JWT via socket.handshake.auth.token
 * - CORS: Configured for frontend domain
 *
 * **Example Usage (in CommentsService):**
 * ```typescript
 * // When comment is created
 * const notification = await this.notificationsService.createNotification({
 *   user_id: postAuthorId,
 *   title: 'New comment on your post',
 *   message: `${commenterName} commented: "${commentPreview}"`,
 *   type: 'post_comment',
 *   related_post_id: postId,
 *   related_comment_id: commentId,
 *   related_user_id: userId,
 * });
 *
 * // Push to online user
 * await this.notificationsGateway.notifyUser(postAuthorId, {
 *   id: notification.id,
 *   title: notification.title,
 *   message: notification.message,
 *   type: notification.type,
 *   relatedPostId: notification.relatedPostId,
 *   relatedCommentId: notification.relatedCommentId,
 *   createdAt: notification.createdAt,
 * });
 * ```
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsGateway],
  exports: [NotificationsService, NotificationsGateway],
})
export class NotificationsModule {}
