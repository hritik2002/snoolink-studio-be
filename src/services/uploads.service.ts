/*
Handles file uploads to the server.
*/
import fs from "fs";
import multer from "multer";
import path from "path";
import uploadToCloudinary from "./cloudinary.service";
import { FILE_SIZE_LIMIT } from "../utils/constants";

export class UploadsService {
  private uploadDir: string;
  private upload: multer.Multer;

  constructor() {
    this.uploadDir = this.getUploadDir();
    this.upload = this.setupFileUpload();
  }

  getUpload() {
    return this.upload;
  }

  getUploadDir() {
    const uploadDir = path.join(process.cwd(), "uploads");

    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    return uploadDir;
  }

  setupFileUpload() {
    const storage = multer.diskStorage({
      destination: (req, file, cb) => {
        cb(null, this.uploadDir);
      },
      filename: (req, file, cb) => {
        cb(null, Date.now() + "-" + file.originalname);
      },
    });

    return multer({
      storage,
      limits: { fileSize: FILE_SIZE_LIMIT }, // 500MB
    });
  }

  deleteUploadedFiles(files: Express.Multer.File[]) {
    files.forEach((file) => {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    });
  }

  async handleFileUpload(
    filePath: string,
    resourceType: "image" | "video" = "image"
  ): Promise<{ fileName: string; fileUrl: string }> {
    const fileUrl = await uploadToCloudinary(filePath, resourceType);
    return {
      fileName: path.basename(filePath),
      fileUrl,
    };
  }
}
