import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class ProfilesService {
    constructor(private readonly prisma: PrismaService) { }

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

        // Handle skills Many-to-Many relation if provided
        const skillsConnectOrCreate = skills?.map(skillName => ({
            where: { name: skillName },
            create: { name: skillName },
        }));

        const updateData: any = {
            ...profileData,
        };

        if (skillsConnectOrCreate) {
            updateData.skills = {
                set: [], // clears existing skills to replace with new ones, or sync them
                connectOrCreate: skillsConnectOrCreate,
            };
        }

        const updatedProfile = await this.prisma.userProfile.upsert({
            where: { userId },
            create: {
                userId,
                ...profileData,
                skills: {
                    connectOrCreate: skillsConnectOrCreate || [],
                },
            },
            update: updateData,
            include: {
                skills: true,
            },
        });

        return updatedProfile;
    }
}

