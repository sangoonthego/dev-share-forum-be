import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { CloudinaryService } from '../media/cloudinary.service';

@Injectable()
export class ProfilesService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly cloudinaryService: CloudinaryService
    ) { }

    async uploadAvatar(userId: number, file: Express.Multer.File) {
        // Step 1: Fetch user's current profile
        const profile = await this.getProfileByUserId(userId);
        const currentAvatarUrl = (profile as any).avatarUrl; // or any specific type

        // Step 2: Delete orphaned file if exists
        if (currentAvatarUrl && currentAvatarUrl.includes('cloudinary.com')) {
            const matches = currentAvatarUrl.match(/\/v\d+\/(devshare\/avatars\/.*?)(?:\.[a-z]+)?$/i);
            if (matches && matches[1]) {
                const publicId = matches[1];
                await this.cloudinaryService.deleteImage(publicId).catch((err) => {
                    console.warn(`Failed to delete legacy avatar on Cloudinary for user ${userId}:`, err.message);
                });
            }
        }

        // Step 3: Upload new avatar
        const result = await this.cloudinaryService.uploadImage(file, 'devshare/avatars');

        // Step 4: Update profile with new avatar URL
        const updatedProfile = await this.prisma.userProfile.upsert({
            where: { userId },
            create: {
                userId,
                avatarUrl: result.url,
            },
            update: {
                avatarUrl: result.url,
            },
            include: {
                skills: true,
            },
        });

        return updatedProfile;
    }

    async getProfileByUserId(userId: number) {
        const profile = await this.prisma.userProfile.findUnique({
            where: { userId },
            include: {
                skills: true,
                user: {
                    select: {
                        id: true,
                        email: true,
                        role: true,

                        createdAt: true,
                    }
                }
            },
        });

        if (!profile) {
            // If profile doesn't exist, we return a basic user info or create a default Profile
            const user = await this.prisma.user.findUnique({
                where: { id: userId },
                select: { id: true, email: true, createdAt: true },
            });
            if (!user) {
                throw new NotFoundException('User not found');
            }
            return { user };
        }

        return profile;
    }

    async updateProfile(userId: number, dto: UpdateProfileDto) {
        const { skills, ...profileData } = dto;

        const updatedProfile = await this.prisma.userProfile.upsert({
            where: { userId },
            create: {
                userId,
                ...profileData,
                skills: skills ? {
                    connectOrCreate: skills.map(skill => ({
                        where: { name: skill.trim() },
                        create: { name: skill.trim() }
                    }))
                } : undefined
            },
            update: {
                ...profileData,
                skills: skills ? {
                    set: [], // Clear old skills entirely
                    connectOrCreate: skills.map(skill => ({
                        where: { name: skill.trim() },
                        create: { name: skill.trim() }
                    }))
                } : undefined
            },
            include: {
                skills: true,
                user: {
                    select: {
                        id: true,
                        email: true,
                    },
                },
            },
        });

        return updatedProfile;
    }

    async getPublicProfile(id: number) {
        const user = await this.prisma.user.findUnique({
            where: { id },
            select: {
                id: true,
                karma: true,
                createdAt: true,
                profile: {
                    include: { skills: true }
                },
                _count: {
                    select: {
                        posts: { where: { status: 'PUBLISHED', deleted_at: null } }
                    }
                }
            }
        });

        if (!user) {
            throw new NotFoundException('User profile not found');
        }

        // Flatten response slightly for a cleaner frontend experience
        const { profile, _count, ...baseUser } = user;
        return {
            ...baseUser,
            stats: {
                publishedPosts: _count.posts
            },
            profile: profile || null
        };
    }
}

