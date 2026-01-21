import { Module } from '@nestjs/common';
import { PostsController } from './posts.controller';
import { PostsService } from './posts.service';
import { EmbeddingService } from './services/embedding.service';
import { OwnershipGuard } from './guards/ownership.guard';
import { MediaModule } from '../media/media.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [MediaModule, UsersModule],
  controllers: [PostsController],
  providers: [PostsService, EmbeddingService, OwnershipGuard],
  exports: [PostsService],
})
export class PostsModule {}
