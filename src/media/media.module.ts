import { Module } from '@nestjs/common';
import { CloudinaryService } from './cloudinary.service';
import { MediaController } from './media.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [MediaController],
  providers: [CloudinaryService],
  exports: [CloudinaryService],
})
export class MediaModule {}
