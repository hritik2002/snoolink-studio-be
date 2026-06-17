import { Router, Request, Response } from "express";
import { SupabaseService } from "../services/supabaseService";
import { authenticateUser } from "../middleware/auth.middleware";
import { analyticsService } from "../services/analytics.service";

const router = Router();
const supabaseService = new SupabaseService();

// Apply authentication middleware to all routes
router.use(authenticateUser);

/**
 * GET /api/collections
 * Get all collections for the authenticated user
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const collections = await supabaseService.getCollections(userId);
    return res.json({ success: true, data: collections });
  } catch (error: any) {
    console.error("Error fetching collections:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/collections
 * Create a new empty collection
 */
router.post("/", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { name, description, collectionType, settings, segmentationConfig } = req.body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ success: false, error: "Collection name is required" });
    }

    const trimmedName = name.trim();
    
    // Validate collection name
    if (trimmedName.length > 100) {
      return res.status(400).json({ success: false, error: "Collection name too long (max 100 characters)" });
    }

    const validTypes = ["media_descriptions", "entities", "face_analysis"];
    const type =
      typeof collectionType === "string" && validTypes.includes(collectionType)
        ? collectionType
        : "media_descriptions";

    const collection = await supabaseService.createCollection(userId, trimmedName, {
      description: typeof description === "string" ? description.trim() : undefined,
      collectionType: type,
      settings: settings && typeof settings === "object" ? settings : {},
      segmentationConfig:
        segmentationConfig && typeof segmentationConfig === "object"
          ? segmentationConfig
          : null,
    });
    analyticsService.track(
      userId,
      "collection_created",
      { name: trimmedName, collectionType: type },
      "server"
    );
    return res.status(201).json({ success: true, data: collection });
  } catch (error: any) {
    console.error("Error creating collection:", error);
    
    if (error.message?.includes("already exists")) {
      return res.status(409).json({ success: false, error: error.message });
    }
    
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/collections/:name
 * Get a single collection by name
 */
router.get("/:name", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const collectionName = decodeURIComponent(req.params.name);

    const collection = await supabaseService.getCollection(userId, collectionName);
    return res.json({ success: true, data: collection });
  } catch (error: any) {
    console.error("Error fetching collection:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PATCH /api/collections/:name
 * Rename a collection
 */
router.patch("/:name", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const oldName = decodeURIComponent(req.params.name);
    const { name: newName, description, collectionType, settings, segmentationConfig } = req.body;

    if (newName !== undefined) {
      if (typeof newName !== "string" || newName.trim().length === 0) {
        return res.status(400).json({ success: false, error: "New collection name is required" });
      }

      const result = await supabaseService.renameCollection(
        userId,
        oldName,
        newName.trim()
      );

      return res.json({ success: true, data: result });
    }

    const metadata = await supabaseService.updateCollectionMetadata(userId, oldName, {
      description: typeof description === "string" ? description : description === null ? null : undefined,
      collectionType: typeof collectionType === "string" ? collectionType : undefined,
      settings: settings && typeof settings === "object" ? settings : undefined,
      segmentationConfig:
        segmentationConfig === null
          ? null
          : segmentationConfig && typeof segmentationConfig === "object"
            ? segmentationConfig
            : undefined,
    });

    return res.json({ success: true, data: metadata });
  } catch (error: any) {
    console.error("Error updating collection:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/collections/:name
 * Delete a collection and all its resources
 */
router.delete("/:name", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const collectionName = decodeURIComponent(req.params.name);

    const result = await supabaseService.deleteCollection(userId, collectionName);
    return res.json({ 
      success: true, 
      message: `Deleted collection "${collectionName}" with ${result.deletedCount} resources` 
    });
  } catch (error: any) {
    console.error("Error deleting collection:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/collections/:name/resources
 * Get resources in a collection with pagination
 * Query params: type, limit, offset
 */
router.get("/:name/resources", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const collectionName = decodeURIComponent(req.params.name);
    const resourceType = req.query.type as "image" | "video" | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

    const result = await supabaseService.getCollectionResourcesPaginated(
      userId,
      collectionName,
      {
        resourceType,
        limit,
        offset,
      }
    );

    return res.json({ success: true, data: result });
  } catch (error: any) {
    console.error("Error fetching collection resources:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/collections/:name/resources
 * Move resources to a collection
 */
router.post("/:name/resources", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const collectionName = decodeURIComponent(req.params.name);
    const { resourceIds } = req.body;

    if (!resourceIds || !Array.isArray(resourceIds) || resourceIds.length === 0) {
      return res.status(400).json({ success: false, error: "resourceIds array is required" });
    }

    const resources = await supabaseService.moveResourcesToCollection(
      userId,
      resourceIds,
      collectionName
    );

    return res.json({ success: true, data: resources });
  } catch (error: any) {
    console.error("Error moving resources to collection:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/collections/:name/resources
 * Delete specific resources from a collection
 */
router.delete("/:name/resources", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { resourceIds } = req.body;

    if (!resourceIds || !Array.isArray(resourceIds) || resourceIds.length === 0) {
      return res.status(400).json({ success: false, error: "resourceIds array is required" });
    }

    const result = await supabaseService.deleteResources(userId, resourceIds);

    return res.json({ success: true, message: `Deleted ${result.deletedCount} resources` });
  } catch (error: any) {
    console.error("Error deleting resources:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
