// TODO: Implement media routes
import { Router } from "express";
import { UploadsService } from "../services/uploads.service.ts";
import { TOTAL_UPLOAD_LIMIT } from "../utils/constants.js";
import ResourceProcessingController from "../controllers/resourceProcessing.controller.ts";

const router = Router();
const resourceProcessingController = new ResourceProcessingController();
const uploadsService = new UploadsService();
const upload = uploadsService.getUpload();

router.get("/get-all-images", async (req, res) => {
  const results = await resourceProcessingController.getAllImages();
  res.json({ success: true, data: results });
});

router.post(
  "/upload-images",
  upload.fields([{ name: "images", maxCount: TOTAL_UPLOAD_LIMIT }]),
  async (req, res) => {
    const files =
      (req.files as { images?: Express.Multer.File[] }).images ?? [];
    if (!files || files.length === 0) {
      return res.status(400).json({ error: "No image files provided" });
    }
    try {
      const results = await resourceProcessingController.upsertImages(files);

      res.json({
        success: true,
        data: results,
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    } finally {
      uploadsService.deleteUploadedFiles(files);
    }
  }
);

export default router;
