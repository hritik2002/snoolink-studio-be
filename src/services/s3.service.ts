import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { CONFIG } from "../config/index";
import fs from "fs";
import path from "path";
import crypto from "crypto";

const s3Client = new S3Client({
  region: CONFIG.s3.region,
  credentials: {
    accessKeyId: CONFIG.s3.accessKeyId,
    secretAccessKey: CONFIG.s3.secretAccessKey,
  },
});

/**
 * Upload a file to S3
 * @param filePath - Local file path to upload
 * @param resourceType - "image" or "video"
 * @returns Public URL of the uploaded file
 */
export default async function uploadToS3(
  filePath: string,
  resourceType: "image" | "video" = "image"
): Promise<string> {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString("hex");
    const sanitizedName = fileName
      .replace(/\.[^/.]+$/, "") // remove extension
      .replace(/[^a-zA-Z0-9\s\-_]/g, "") // remove special chars
      .replace(/\s+/g, "_") // replace spaces with underscore
      .substring(0, 50);
    
    const extension = path.extname(fileName);
    const key = `snoolink-studio/${resourceType}s/${timestamp}_${random}_${sanitizedName}${extension}`;

    const command = new PutObjectCommand({
      Bucket: CONFIG.s3.bucketName,
      Key: key,
      Body: fileBuffer,
      ContentType: resourceType === "image" ? "image/png" : "video/mp4",
    });

    await s3Client.send(command);

    // Return public URL
    const publicUrl = `https://${CONFIG.s3.bucketName}.s3.${CONFIG.s3.region}.amazonaws.com/${key}`;
    return publicUrl;
  } catch (err) {
    console.error("S3 upload error:", err);
    throw new Error(`Failed to upload ${resourceType} to S3: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

/**
 * Generate a presigned URL for direct upload from client
 * @param key - S3 object key
 * @param contentType - MIME type of the file
 * @param expiresIn - URL expiration time in seconds (default: 3600 = 1 hour)
 * @returns Presigned URL
 */
export async function generatePresignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn: number = 3600
): Promise<string> {
  try {
    const command = new PutObjectCommand({
      Bucket: CONFIG.s3.bucketName,
      Key: key,
      ContentType: contentType,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn });
    return presignedUrl;
  } catch (err) {
    console.error("Error generating presigned URL:", err);
    throw new Error(`Failed to generate presigned URL: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

/**
 * Generate a presigned URL for downloading/viewing a file
 * @param key - S3 object key
 * @param expiresIn - URL expiration time in seconds (default: 3600 = 1 hour)
 * @returns Presigned URL
 */
export async function generatePresignedDownloadUrl(
  key: string,
  expiresIn: number = 3600
): Promise<string> {
  try {
    const command = new GetObjectCommand({
      Bucket: CONFIG.s3.bucketName,
      Key: key,
    });

    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn });
    return presignedUrl;
  } catch (err) {
    console.error("Error generating presigned download URL:", err);
    throw new Error(`Failed to generate presigned download URL: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

/**
 * Delete a file from S3
 * @param key - S3 object key
 */
export async function deleteFromS3(key: string): Promise<void> {
  try {
    const command = new DeleteObjectCommand({
      Bucket: CONFIG.s3.bucketName,
      Key: key,
    });

    await s3Client.send(command);
  } catch (err) {
    console.error("Error deleting from S3:", err);
    throw new Error(`Failed to delete from S3: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}

/**
 * Extract S3 key from a public URL
 * @param url - Public S3 URL
 * @returns S3 key
 */
export function extractS3KeyFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url);
    // Remove leading slash from pathname
    return urlObj.pathname.substring(1);
  } catch {
    return null;
  }
}
