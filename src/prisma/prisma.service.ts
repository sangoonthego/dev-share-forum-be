import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as dotenv from 'dotenv';

// Nạp biến môi trường ngay lập tức
dotenv.config();

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const connectionString = process.env.DATABASE_URL;

    // Kiểm tra tính hợp lệ của chuỗi kết nối
    if (!connectionString) {
      throw new Error('DATABASE_URL is not defined in .env file');
    }

    const pool = new Pool({ 
        connectionString,
        // Đảm bảo password luôn là string, nếu pg parse sai nó sẽ báo lỗi ngay tại đây
    });

    const adapter = new PrismaPg(pool);
    super({ adapter });
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('Database Connected Successfully via Adapter!');
    } catch (error) {
      this.logger.error('Error when Connecting DB:', error.message);
      // Không nên dùng console.error ở đây để đồng nhất với Logger của Nest
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}