import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

export default async function uploadVideoToCloudinary(filePath) {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      resource_type: "video",
      folder: "snoolink-studio",
      sign_url: false,
    });

    return result.secure_url;
  } catch (err) {
    console.error("Cloudinary upload error:", err);
    throw new Error("Failed to upload video to Cloudinary");
  }
}
