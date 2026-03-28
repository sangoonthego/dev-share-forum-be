import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { UserActivityService } from './user-activity.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [UsersController],
  providers: [UsersService, UserActivityService],
  exports: [UsersService, UserActivityService],
})
export class UsersModule {}

