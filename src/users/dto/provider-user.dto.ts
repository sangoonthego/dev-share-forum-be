import { IsString, IsEmail, IsNotEmpty, IsUrl, IsOptional, IsEnum } from 'class-validator';

export enum ProviderType {
    GOOGLE = 'google',
    GITHUB = 'github',
}

export class ProviderUserDto {
    @IsEmail()
    @IsNotEmpty()
    email: string;

    @IsEnum(ProviderType)
    provider: ProviderType | string;

    @IsString()
    @IsOptional()
    googleId?: string;

    @IsString()
    @IsOptional()
    githubId?: string;

    @IsString()
    @IsOptional()
    githubUsername?: string;

    @IsString()
    @IsOptional()
    full_name?: string | null;

    @IsUrl()
    @IsOptional()
    profile_avatar?: string | null;
}

