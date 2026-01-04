import { IsEmail, IsNotEmpty, IsString, MinLength, IsOptional } from 'class-validator';

// 1. JWT & Token Interfaces
export class JwtPayload {
    sub: number;
    email: string;
    role: string;
    version: number; // revoke all of tokens when change pass
}

export interface Tokens {
    access_token: string;
    refresh_token: string;
}

// 2. Register DTO
export class RegisterDto {
    @IsEmail({}, { message: 'Invalid email format' })
    @IsNotEmpty({ message: 'Email is required' })
    email: string;

    @IsString()
    @IsNotEmpty({ message: 'Password is required' })
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
}

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