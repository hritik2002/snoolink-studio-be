import { ResourceProcessingService } from "../services/resrouceProcessing.service";
import { UploadsService } from "../services/uploads.service";
import { SupabaseService } from "../services/supabaseService";

class ResourceProcessingController {
  private resourceProcessingService: ResourceProcessingService;
  private uploadsService: UploadsService;
  private supabaseService: SupabaseService;
  constructor() {
    this.resourceProcessingService = new ResourceProcessingService();
    this.uploadsService = new UploadsService();
    this.supabaseService = new SupabaseService();
  }

  async upsertImages(imagePaths: Express.Multer.File[]) {
    const promises = imagePaths.map(async (image) => {
      const { fileUrl } = await this.uploadsService.handleFileUpload(
        image.path,
        "image"
      );
      const description = await this.resourceProcessingService.describeImage(
        image.path
      );
      const id = await this.resourceProcessingService.embedImage({
        description,
        imageUrl: fileUrl,
      });

      return {
        id,
        description,
        imageUrl: fileUrl,
      };
    });

    const results = await Promise.all(promises);
    await this.supabaseService.postImages(results);

    return results;
  }

  async getAllImages() {
    const images = await this.supabaseService.getImages();
    return images;
  }
}

export default ResourceProcessingController;
