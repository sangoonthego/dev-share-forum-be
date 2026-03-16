import { IsEmail, IsNotEmpty, IsString, MinLength, IsOptional, Matches } from 'class-validator';

export class JwtPayload {
    sub: number;
    email: string;
    role: string;
    version: number; 
    jti?: string; 
    family: string;
}

export interface Tokens {
    access_token: string;
    refresh_token: string;
    csrf_token: string;
}

export class RegisterDto {
    @IsEmail({}, { message: 'Invalid email format' })
    @IsNotEmpty({ message: 'Email is required' })
    @Matches(/^[^@]{5,}@/, {
        message: "Email must have at least 5 characterist before @!!!"
    })
    email: string;

    @IsString()
    @IsNotEmpty({ message: 'Password is required' })
    @Matches(/[A-Z]/, {
        message: "Password must be at least an Uppercase"
    })
    @MinLength(6, { message: 'Password must be at least 6 characters' })
    password: string;

    @IsString()
    @IsOptional()
    full_name?: string;

    @IsString()
    @IsOptional()
    phone?: string;
}

export class LoginDto {
    @IsEmail({}, { message: 'Invalid email format' })
    @IsNotEmpty({ message: 'Email is required' })
    email: string;

    @IsString()
    @IsNotEmpty({ message: 'Password is required' })
    password: string;
};

export class ChangePasswordDto {
    @IsString()
    @IsNotEmpty({ message: 'Current password is required' })
    current_password: string;

    @IsString()
    @IsNotEmpty({ message: 'New password is required' })
    @MinLength(6, { message: 'New password must be at least 6 characters' })
    new_password: string;

    @IsString()
    @IsNotEmpty({ message: 'Password confirmation is required' })
    new_password_confirm: string;
}

export class UserProfileResponse {
    id: number;
    email: string;
    full_name: string | null;
    phone: string | null;
    profile_avatar: string | null;
    role: string;
    karma: number;
    created_at: Date;
    updated_at: Date;
}

export class AuthResponse {
    access_token: string;
    csrf_token?: string; // Optional CSRF token for frontend
}

export class ExchangeCodeDto {
    @IsString()
    @IsNotEmpty({ message: 'Authorization code is required' })
    code: string;
}

export interface OAuthProfile {
    provider: 'google' | 'github'; // Which OAuth provider
    providerId: string; // Provider's unique user ID (googleId / githubId)
    email: string;
    full_name: string | null;
    profile_avatar: string | null;
    // Provider-specific fields
    googleId?: string;
    githubId?: string;
    githubUsername?: string;
}

export interface OAuthUserResponse {
    id: number;
    email: string;
    full_name: string | null;
    profile_avatar: string | null;
    // Include tokens for frontend to store
    access_token: string;
    refresh_token: string;
    csrf_token: string; // CSRF token for frontend
}