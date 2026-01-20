import { IsEmail, IsNotEmpty, IsString, MinLength, IsOptional, Matches } from 'class-validator';

// 1. JWT & Token Interfaces
export class JwtPayload {
    sub: number;
    email: string;
    role: string;
    version: number; // revoke all of tokens when change pass
    jti?: string; // JWT ID for blacklisting
    family: string;
}

export interface Tokens {
    access_token: string;
    refresh_token: string;
}

// 2. Register DTO
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

// 3. Login DTO
export class LoginDto {
    @IsEmail({}, { message: 'Invalid email format' })
    @IsNotEmpty({ message: 'Email is required' })
    email: string;

    @IsString()
    @IsNotEmpty({ message: 'Password is required' })
    password: string;
};

// 4. Change Password DTO
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

// 5. Response DTOs
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
}

// 6. OAuth Profile DTO (from Passport strategies)
/**
 * OAuthProfile - Standardized OAuth user profile from Passport strategies
 * 
 * Used by Google and GitHub strategies to return user info
 * Contains provider-specific IDs for account linking
 */
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

/**
 * OAuthUserResponse - User data returned after OAuth validation
 * 
 * Includes tokens for immediate login after OAuth callback
 */
export interface OAuthUserResponse {
    id: number;
    email: string;
    full_name: string | null;
    profile_avatar: string | null;
    // Include tokens for frontend to store
    access_token: string;
    refresh_token: string;
}