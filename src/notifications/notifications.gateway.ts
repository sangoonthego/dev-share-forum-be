import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  SubscribeMessage,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NotificationsService } from './notifications.service';
import { WebSocketNotificationDto } from './dto/notification.dto';

/**
 * **NotificationsGateway - Real-time WebSocket Implementation**
 *
 * **Architecture:**
 * - Uses Socket.IO for WebSocket with fallback support
 * - JWT authentication via socket handshake (custom middleware)
 * - Connected users mapped: userId → Socket ID
 * - Each user can have multiple sockets (mobile + web)
 *
 * **Authentication Flow:**
 * 1. Client connects with `Authorization` header: `Bearer <token>`
 * 2. Server decodes JWT and extracts userId
 * 3. Socket joined to room: `user:{userId}`
 * 4. Server can emit to room for all user devices
 *
 * **Real-time Delivery:**
 * - User online: Instant WebSocket push
 * - User offline: Notification saved in DB (pulled on reconnect)
 *
 * **Events:**
 * - `notification` (SERVER→CLIENT): New notification pushed
 * - `notification:read` (CLIENT→SERVER): User marks as read
 * - `notification:read:all` (CLIENT→SERVER): Mark all as read
 *
 * **Example Client Code:**
 * ```typescript
 * const socket = io('http://localhost:3000', {
 *   auth: {
 *     token: localStorage.getItem('access_token'),
 *   },
 * });
 *
 * socket.on('notification', (notif: WebSocketNotificationDto) => {
 *   console.log('New notification:', notif.title);
 *   showBadge(notif.id);
 * });
 *
 * socket.emit('notification:read', { notificationId: 123 });
 * ```
 */
@WebSocketGateway({
  cors: {
    origin: '*', // Configure based on frontend domain in production
    credentials: true,
  },
  namespace: '/notifications', // Separate namespace to avoid conflicts
})
@Injectable()
export class NotificationsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(NotificationsGateway.name);
  private connectedUsers = new Map<number, Set<string>>(); // userId → Set<socketIds>

  constructor(
    private jwtService: JwtService,
    private notificationsService: NotificationsService,
  ) {}

  /**
   * Initialize gateway with JWT authentication middleware
   *
   * Workflow:
   * 1. Register authentication middleware
   * 2. Decode JWT from handshake headers
   * 3. Add userId to socket data
   * 4. Allow or reject connection
   */
  afterInit(server: Server) {
    // Authentication middleware
    server.use((socket: Socket, next: any) => {
      try {
        const token = socket.handshake.auth?.token;

        if (!token) {
          return next(
            new UnauthorizedException('Missing or invalid token'),
          );
        }

        // Decode JWT
        const payload = this.jwtService.verify(token, {
          secret: process.env.JWT_AT_SECRET || 'access_token_secret',
        });

        // Attach user info to socket
        (socket as any).userId = payload.sub;
        (socket as any).email = payload.email;

        this.logger.debug(
          `[JWT Auth] User ${payload.sub} (${payload.email}) authenticated`,
        );

        next();
      } catch (error) {
        this.logger.warn(
          `[JWT Auth] Authentication failed: ${error.message}`,
        );
        return next(
          new UnauthorizedException('Invalid token'),
        );
      }
    });

    this.logger.log('[Gateway] NotificationsGateway initialized');
  }

  /**
   * Handle new WebSocket connection
   *
   * Workflow:
   * 1. Extract userId from socket
   * 2. Add socket to user's set
   * 3. Join Socket.IO room: `user:{userId}`
   * 4. Log connection
   *
   * **Note:** Multiple sockets per user are supported (mobile + web)
   */
  handleConnection(socket: Socket) {
    const userId = (socket as any).userId;
    const email = (socket as any).email;

    if (!userId) {
      this.logger.warn('[Connection] Socket missing userId, disconnecting');
      socket.disconnect();
      return;
    }

    // Track connected user
    if (!this.connectedUsers.has(userId)) {
      this.connectedUsers.set(userId, new Set());
    }
    const userSockets = this.connectedUsers.get(userId);
    if (userSockets) {
      userSockets.add(socket.id);
    }

    // Join room for user-specific broadcasts
    socket.join(`user:${userId}`);

    const socketCount = this.connectedUsers.get(userId)?.size || 0;
    this.logger.log(
      `[Connection] User ${userId} (${email}) connected. ` +
      `Socket: ${socket.id}. Total sockets: ${socketCount}`,
    );
  }

  /**
   * Handle WebSocket disconnection
   *
   * Cleanup: Remove socket from user's set
   * If user has no more sockets, remove from tracking
   */
  handleDisconnect(socket: Socket) {
    const userId = (socket as any).userId;

    if (!userId) return;

    const userSockets = this.connectedUsers.get(userId);
    if (userSockets) {
      userSockets.delete(socket.id);
      if (userSockets.size === 0) {
        this.connectedUsers.delete(userId);
      }
    }

    this.logger.log(
      `[Disconnection] User ${userId} disconnected. ` +
      `Socket: ${socket.id}`,
    );
  }

  /**
   * Push notification to online user(s)
   *
   * Used by: CommentsService after creating notification
   *
   * Sends to: All sockets in `user:{userId}` room (all user devices)
   * Format: WebSocketNotificationDto with auto-added timestamp
   *
   * **Workflow:**
   * 1. Ensure null-safety: convert undefined to null
   * 2. Add timestamp from Date.now()
   * 3. Emit to user's room (all devices)
   * 4. Log delivery status
   *
   * **Note:** If user offline, notification already saved in DB
   *
   * @param userId - Target user ID
   * @param notification - Notification to push (timestamp will be auto-added)
   */
  async pushNotificationToUser(
    userId: number,
    notification: WebSocketNotificationDto,
  ) {
    const notificationWithTimestamp: WebSocketNotificationDto = {
      id: notification.id,
      title: notification.title,
      message: notification.message,
      type: notification.type,
      relatedCommentId: notification.relatedCommentId ?? null,
      relatedPostId: notification.relatedPostId ?? null,
      relatedUserId: notification.relatedUserId ?? null,
      createdAt: notification.createdAt,
      timestamp: Date.now(), // Auto-add timestamp
    };

    this.server.to(`user:${userId}`).emit('notification', notificationWithTimestamp);

    const isOnline = this.connectedUsers.has(userId);
    this.logger.debug(
      `[Push] Notification sent to user ${userId} (online: ${isOnline})`,
    );
  }

  /**
   * CLIENT EVENT: User marks notification as read
   *
   * Workflow:
   * 1. Extract userId from socket
   * 2. Call service to update database
   * 3. Broadcast update to user's sockets (optional)
   * 4. Send confirmation to client
   */
  @SubscribeMessage('notification:read')
  async handleNotificationRead(
    @ConnectedSocket() socket: Socket,
    @MessageBody() data: { notificationId: number },
  ) {
    const userId = (socket as any).userId;

    try {
      await this.notificationsService.markAsRead(
        data.notificationId,
        userId,
      );

      // Broadcast update to user's other sockets
      socket.to(`user:${userId}`).emit('notification:read:updated', {
        notificationId: data.notificationId,
      });

      // Send confirmation back to client
      socket.emit('notification:read:success', {
        notificationId: data.notificationId,
      });

      this.logger.debug(
        `[Event] Notification ${data.notificationId} marked as read by user ${userId}`,
      );
    } catch (error) {
      socket.emit('notification:read:error', {
        notificationId: data.notificationId,
        error: error.message,
      });
    }
  }

  /**
   * CLIENT EVENT: User marks all notifications as read
   *
   * Workflow:
   * 1. Extract userId
   * 2. Update all in database
   * 3. Broadcast to user's devices
   * 4. Send confirmation
   */
  @SubscribeMessage('notification:read:all')
  async handleMarkAllAsRead(
    @ConnectedSocket() socket: Socket,
  ) {
    const userId = (socket as any).userId;

    try {
      const count = await this.notificationsService.markAllAsRead(userId);

      // Broadcast to user's other sockets
      socket.to(`user:${userId}`).emit('notification:all:read', {
        count,
      });

      // Send confirmation
      socket.emit('notification:all:read:success', { count });

      this.logger.debug(
        `[Event] ${count} notifications marked as read by user ${userId}`,
      );
    } catch (error) {
      socket.emit('notification:all:read:error', {
        error: error.message,
      });
    }
  }

  /**
   * CLIENT EVENT: Request unread count (e.g., for notification badge)
   *
   * Lightweight query for quick badge updates
   */
  @SubscribeMessage('notification:unread-count')
  async handleUnreadCount(
    @ConnectedSocket() socket: Socket,
  ) {
    const userId = (socket as any).userId;

    try {
      const unreadCount =
        await this.notificationsService.getUnreadCount(userId);
      socket.emit('notification:unread-count:response', { unreadCount });
    } catch (error) {
      socket.emit('notification:unread-count:error', {
        error: error.message,
      });
    }
  }

  /**
   * Helper: Emit notification to user
   *
   * Internal API for CommentsService to trigger real-time push
   *
   * @param userId - Target user
   * @param notification - Notification data
   */
  async notifyUser(
    userId: number,
    notification: WebSocketNotificationDto,
  ) {
    await this.pushNotificationToUser(userId, notification);
  }

  /**
   * Helper: Check if user is online
   *
   * @param userId - User to check
   * @returns True if user has active sockets
   */
  isUserOnline(userId: number): boolean {
    return this.connectedUsers.has(userId);
  }

  /**
   * Helper: Get active socket count for user
   *
   * @param userId - User ID
   * @returns Number of connected sockets
   */
  getSocketCountForUser(userId: number): number {
    return this.connectedUsers.get(userId)?.size || 0;
  }
}
