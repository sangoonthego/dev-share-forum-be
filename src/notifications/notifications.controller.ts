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

@Controller('notifications')
@UseGuards(AtGuard)
export class NotificationsController {
  constructor(private notificationsService: NotificationsService) {}

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

  @Get('count/unread')
  @HttpCode(HttpStatus.OK)
  async getUnreadCount(
    @Req() req: Request,
  ) {
    const user = req.user as JwtPayload;
    const unreadCount = await this.notificationsService.getUnreadCount(user.sub);
    return { unreadCount };
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  async getNotification(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<NotificationResponseDto> {
    const user = req.user as JwtPayload;
    return this.notificationsService.getNotificationById(Number(id), user.sub);
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  async markAsRead(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<NotificationResponseDto> {
    const user = req.user as JwtPayload;
    return this.notificationsService.markAsRead(Number(id), user.sub);
  }

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
