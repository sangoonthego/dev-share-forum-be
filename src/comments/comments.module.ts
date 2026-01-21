import { Module } from '@nestjs/common';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { CommentOwnershipGuard } from './guards/comment-ownership.guard';
import { NotificationsModule } from 'src/notifications/notifications.module';
import { UsersModule } from 'src/users/users.module';

@Module({
  imports: [NotificationsModule, UsersModule],
  controllers: [CommentsController],
  providers: [CommentsService, CommentOwnershipGuard],
  exports: [CommentsService, CommentOwnershipGuard],
})
export class CommentsModule {}
