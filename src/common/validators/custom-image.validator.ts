import { FileValidator } from '@nestjs/common';

export class CustomImageValidator extends FileValidator<Record<string, any>> {
    buildErrorMessage(): string {
        return 'Validation failed: File must be a valid image (jpeg, jpg, png, webp)';
    }

    isValid(file?: Express.Multer.File): boolean {
        return !!file && !!file.mimetype && file.mimetype.includes('image/');
    }
}