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

@WebSocketGateway({
  cors: {
    origin: '*', 
    credentials: true,
  },
  namespace: '/notifications', 
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

        const payload = this.jwtService.verify(token, {
          secret: process.env.JWT_AT_SECRET || 'access_token_secret',
        });

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

  handleConnection(socket: Socket) {
    const userId = (socket as any).userId;
    const email = (socket as any).email;

    if (!userId) {
      this.logger.warn('[Connection] Socket missing userId, disconnecting');
      socket.disconnect();
      return;
    }

    if (!this.connectedUsers.has(userId)) {
      this.connectedUsers.set(userId, new Set());
    }
    const userSockets = this.connectedUsers.get(userId);
    if (userSockets) {
      userSockets.add(socket.id);
    }

    socket.join(`user:${userId}`);

    const socketCount = this.connectedUsers.get(userId)?.size || 0;
    this.logger.log(
      `[Connection] User ${userId} (${email}) connected. ` +
      `Socket: ${socket.id}. Total sockets: ${socketCount}`,
    );
  }

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

      socket.to(`user:${userId}`).emit('notification:read:updated', {
        notificationId: data.notificationId,
      });

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

  @SubscribeMessage('notification:read:all')
  async handleMarkAllAsRead(
    @ConnectedSocket() socket: Socket,
  ) {
    const userId = (socket as any).userId;

    try {
      const count = await this.notificationsService.markAllAsRead(userId);

      socket.to(`user:${userId}`).emit('notification:all:read', {
        count,
      });

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

  async notifyUser(
    userId: number,
    notification: WebSocketNotificationDto,
  ) {
    await this.pushNotificationToUser(userId, notification);
  }

  isUserOnline(userId: number): boolean {
    return this.connectedUsers.has(userId);
  }

  getSocketCountForUser(userId: number): number {
    return this.connectedUsers.get(userId)?.size || 0;
  }
}
