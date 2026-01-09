import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UserActivityType } from '@prisma/client';

export interface ActivityDay {
  date: string; // YYYY-MM-DD format
  count: number;
}

/**
 * UserActivityService - Contribution tracking (GitHub-style chart)
 * 
 * Logs user actions and provides efficient 365-day activity data
 * Uses indexed (user_id, created_at) for performance with large datasets
 */
@Injectable()
export class UserActivityService {
  constructor(private prisma: PrismaService) {}

  /**
   * Log a user activity
   * Called when: post created, post updated, comment created
   */
  async logActivity(
    userId: number,
    activityType: UserActivityType,
    postId?: number,
    commentId?: number,
  ): Promise<void> {
    await this.prisma.user_activities.create({
      data: {
        user_id: userId,
        activity_type: activityType,
        post_id: postId,
        comment_id: commentId,
      },
    });
  }

  /**
   * Get 365-day activity data for profile
   * Returns grouped activity counts by date
   * 
   * Optimized with:
   * - Index on (user_id, created_at) for efficient range scan
   * - Raw SQL grouping for optimal performance
   * 
   * Returns array: [{ date: "2025-01-09", count: 5 }, ...]
   */
  async get365DayActivity(userId: number): Promise<ActivityDay[]> {
    // Query raw activity data from past 365 days
    const activities = await this.prisma.$queryRaw<
      Array<{ date: Date; count: number }>
    >`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as count
      FROM user_activities
      WHERE user_id = ${userId}
        AND created_at >= NOW() - INTERVAL '365 days'
      GROUP BY DATE(created_at)
      ORDER BY DATE(created_at) ASC
    `;

    // Format results as YYYY-MM-DD with proper type conversion
    return activities.map((row: any) => ({
      date: new Date(row.date).toISOString().split('T')[0],
      count: parseInt(row.count, 10),
    }));
  }

  /**
   * Get activity summary for date range
   * Useful for weekly/monthly stats
   */
  async getActivitySummary(
    userId: number,
    startDate: Date,
    endDate: Date,
  ): Promise<{ total: number; byType: Record<string, number> }> {
    const activities = await this.prisma.user_activities.findMany({
      where: {
        user_id: userId,
        created_at: {
          gte: startDate,
          lte: endDate,
        },
      },
    });

    const byType: Record<string, number> = {};
    let total = 0;

    for (const activity of activities) {
      total++;
      byType[activity.activity_type] =
        (byType[activity.activity_type] || 0) + 1;
    }

    return { total, byType };
  }

  /**
   * Get recent activities for a user
   * Useful for activity feed
   */
  async getRecentActivities(
    userId: number,
    limit: number = 10,
  ): Promise<any[]> {
    return this.prisma.user_activities.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: limit,
    });
  }

  /**
   * Delete activities related to a post or comment
   * Called when user deletes content
   */
  async deleteActivitiesByPost(postId: number): Promise<number> {
    const result = await this.prisma.user_activities.deleteMany({
      where: { post_id: postId },
    });
    return result.count;
  }

  async deleteActivitiesByComment(commentId: number): Promise<number> {
    const result = await this.prisma.user_activities.deleteMany({
      where: { comment_id: commentId },
    });
    return result.count;
  }
}
