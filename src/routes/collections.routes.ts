import { Router, Request, Response } from "express";
import { SupabaseService } from "../services/supabaseService";
import { authenticateUser } from "../middleware/auth.middleware";

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
    const { name: newName } = req.body;

    if (!newName || typeof newName !== "string" || newName.trim().length === 0) {
      return res.status(400).json({ success: false, error: "New collection name is required" });
    }

    const result = await supabaseService.renameCollection(
      userId,
      oldName,
      newName.trim()
    );

    return res.json({ success: true, data: result });
  } catch (error: any) {
    console.error("Error renaming collection:", error);
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
 * Get all resources in a collection
 */
router.get("/:name/resources", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const collectionName = decodeURIComponent(req.params.name);
    const resourceType = req.query.type as "image" | "video" | undefined;

    const resources = await supabaseService.getCollectionResources(
      userId,
      collectionName,
      resourceType
    );

    return res.json({ success: true, data: resources });
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
