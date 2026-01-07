import { Module, Global, Provider } from '@nestjs/common';
import { Redis } from 'ioredis';
import { RedisService } from './redis.service';

const redisProvider: Provider = {
  provide: 'REDIS_CLIENT',
  useFactory: () => {
    const redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0'),
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      enableOfflineQueue: true,
      connectTimeout: 10000,
      keepAlive: 30000,
      lazyConnect: false,
    });

    redis.on('error', (err) => {
      console.error('Redis connection error:', err);
    });

    redis.on('connect', () => {
      console.log('Redis connected');
    });

    return redis;
  },
};

/**
 * Redis Module - Global Redis configuration
 * 
 * Handles:
 * - JWT Blacklisting (jti storage)
 * - Refresh Token Storage (replacing PostgreSQL)
 * - Session Management
 * - Rate Limiting Counters
 * 
 * Connection pooling and reconnection handled by ioredis
 */
@Global()
@Module({
  providers: [redisProvider, RedisService],
  exports: [RedisService],
})
export class RedisModule {}
