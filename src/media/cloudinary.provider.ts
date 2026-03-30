export const CloudinaryProvider = {
  provide: 'CLOUDINARY',
  useFactory: () => {
    // We import dynamically or require since it's common
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const v2 = require('cloudinary').v2;
    return v2.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  },
};
