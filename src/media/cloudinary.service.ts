import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';

export interface UploadResponse {
  url: string;
  publicId: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

@Injectable()
export class CloudinaryService {
  constructor() {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  }

  async uploadImage(
    file: any,
    folder: string = 'devshare',
  ): Promise<UploadResponse> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder,
          resource_type: 'auto',
          eager: [
            { width: 400, height: 300, crop: 'fill', quality: 'auto' },
            { width: 800, height: 600, crop: 'fill', quality: 'auto' },
          ],
        },
        (error, result) => {
          if (error) {
            return reject(
              new InternalServerErrorException(
                `Cloudinary upload failed: ${error.message}`,
              ),
            );
          }

          if (!result) {
            return reject(
              new InternalServerErrorException('Cloudinary upload returned no result'),
            );
          }

          resolve({
            url: result.secure_url,
            publicId: result.public_id,
            fileName: file.originalname,
            fileSize: file.size,
            mimeType: file.mimetype,
          });
        },
      );

      // Convert multer buffer to stream and pipe to Cloudinary
      const readable = Readable.from(file.buffer);
      readable.pipe(uploadStream);
    });
  }

  async deleteImage(publicId: string): Promise<void> {
    try {
      const result = await cloudinary.uploader.destroy(publicId);
      if (result.result !== 'ok') {
        throw new Error(`Cloudinary deletion returned: ${result.result}`);
      }
    } catch (error: any) {
      throw new InternalServerErrorException(
        `Failed to delete image from Cloudinary: ${error.message}`,
      );
    }
  }

  generateSignature(params: Record<string, any>): {
    signature: string;
    timestamp: number;
  } {
    const timestamp = Math.floor(Date.now() / 1000);
    const secret = process.env.CLOUDINARY_API_SECRET;
    
    if (!secret) {
      throw new InternalServerErrorException('CLOUDINARY_API_SECRET not configured');
    }

    const signature = cloudinary.utils.api_sign_request(
      { ...params, timestamp },
      secret,
    );

    return { signature, timestamp };
  }
}
