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

  async upsertImages(imagePaths: Express.Multer.File[], userId: string) {
    const promises = imagePaths.map(async (image) => {
      const { fileUrl } = await this.uploadsService.handleFileUpload(
        image.path,
        "image"
      );
      const description = await this.resourceProcessingService.describeImage(
        fileUrl
      );
      const id = await this.resourceProcessingService.embedImage({
        description,
        imageUrl: fileUrl,
        userId,
      });

      return {
        id,
        description,
        imageUrl: fileUrl,
      };
    });

    const results = await Promise.all(promises);
    await this.supabaseService.postImages(results, userId);

    return results;
  }

  async getAllImages(userId: string) {
    const images = await this.supabaseService.getImages(userId);
    return images;
  }

  async searchImages(query: string, userId: string) {
    const expandedQuery = await this.resourceProcessingService
      .expandQuery(`User Query: "${query}"
        Expanded:`);

    const results = await this.resourceProcessingService.searchImages({
      query: expandedQuery,
      userId,
    });
    return results;
  }
}

export default ResourceProcessingController;
