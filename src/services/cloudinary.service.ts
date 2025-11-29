import { v2 as cloudinary } from "cloudinary";
import { CONFIG } from "../config/index";

cloudinary.config({ ...CONFIG.cloudinary });

export default async function uploadToCloudinary(
  filePath: string,
  resourceType: "image" | "video" = "image"
): Promise<string> {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      resource_type: resourceType as "image" | "video",
      folder: "snoolink-studio",
      sign_url: false,
    });

    return result.secure_url;
  } catch (err) {
    console.error("Cloudinary upload error:", err);
    throw new Error(`Failed to upload ${resourceType} to Cloudinary`);
  }
}
