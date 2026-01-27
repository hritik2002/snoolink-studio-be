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
    const randomId = crypto.randomBytes(12).toString("hex");
    const extension = path.extname(fileName) || (resourceType === "image" ? ".png" : ".mp4");
    const key = `snoolink-studio/${resourceType}s/${timestamp}_${randomId}${extension}`;

    const command = new PutObjectCommand({
      Bucket: CONFIG.s3.bucketName,
      Key: key,
      Body: fileBuffer,
      ContentType: resourceType === "image" ? "image/png" : "video/mp4",
    });

    await s3Client.send(command);

    // Return public URL (CDN if configured, else direct S3)
    const base =
      CONFIG.s3.publicBaseUrl ||
      `https://${CONFIG.s3.bucketName}.s3.${CONFIG.s3.region}.amazonaws.com`;
    return `${base}/${key}`;
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

/**
 * Check if a URL is our S3 bucket URL (virtual-hosted, path-style, or CDN)
 */
export function isOurS3Url(url: string): boolean {
  if (!url?.startsWith("http")) return false;
  try {
    const u = new URL(url);
    const virtualHosted =
      CONFIG.s3.bucketName &&
      u.hostname === `${CONFIG.s3.bucketName}.s3.${CONFIG.s3.region}.amazonaws.com`;
    const pathStyle =
      u.hostname === `s3.${CONFIG.s3.region}.amazonaws.com` &&
      u.pathname.startsWith(`/${CONFIG.s3.bucketName}/`);
    const cdnHost = CONFIG.s3.publicBaseUrl ? new URL(CONFIG.s3.publicBaseUrl).hostname : null;
    const isCdn = cdnHost && u.hostname === cdnHost;
    return !!(virtualHosted || pathStyle || isCdn);
  } catch {
    return false;
  }
}

/**
 * Fetch an S3 object as a Buffer (uses backend credentials).
 * Use this when OpenAI or other services cannot access the bucket directly (e.g. private bucket).
 */
export async function getObjectAsBuffer(key: string): Promise<Buffer> {
  const command = new GetObjectCommand({
    Bucket: CONFIG.s3.bucketName,
    Key: key,
  });
  const response = await s3Client.send(command);
  const body = response.Body;
  if (!body) throw new Error("Empty S3 object body");
  const chunks: Uint8Array[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * If the URL is our S3 bucket, fetch the object and return its buffer; otherwise return null.
 */
export async function getImageBufferFromS3Url(url: string): Promise<Buffer | null> {
  if (!isOurS3Url(url)) return null;
  const key = extractS3KeyFromUrl(url);
  if (!key) return null;
  try {
    return await getObjectAsBuffer(key);
  } catch (err) {
    console.error("S3 getObject error for image description:", err);
    throw new Error(`Failed to fetch image from S3: ${err instanceof Error ? err.message : "Unknown error"}`);
  }
}
