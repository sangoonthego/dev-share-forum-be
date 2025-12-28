// import { Injectable } from '@nestjs/common';

// @Injectable()
// export class PrismaService {}

import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super();
  }

  async onModuleInit() {
    try {
      await this.$connect();
      console.log('Database Connect Successfully!');
    } catch (error) {
      console.error('Error when Connecting DB:', error);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}