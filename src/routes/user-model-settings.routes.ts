import { Router, Request, Response } from "express";
import { authenticateUser } from "../middleware/auth.middleware";
import { SupabaseService } from "../services/supabaseService";

const router = Router();
const supabaseService = new SupabaseService();

router.use(authenticateUser);

/** GET /api/user-model-settings - Get current user's search_model and ingestion_model. */
router.get("/", async (req: Request, res: Response) => {
  try {
    const s = await supabaseService.getUserModelSettings(req.user!.id);
    res.json({ success: true, data: s });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e?.message || "Failed to get settings" });
  }
});

  /** PUT /api/user-model-settings - Update. Body: { search_model?, ingestion_model?, min_score? }. Empty string / null = use default. min_score: 0–1 or null. */
router.put("/", async (req: Request, res: Response) => {
  try {
    const { search_model, ingestion_model, min_score } = req.body;
    let minScoreVal: number | null = null;
    if (min_score != null && min_score !== "") {
      const n = Number(min_score);
      if (!Number.isNaN(n)) minScoreVal = Math.max(0, Math.min(1, n));
    }
    const s = await supabaseService.upsertUserModelSettings(req.user!.id, {
      search_model: (typeof search_model === "string" && search_model.trim()) ? search_model.trim() : null,
      ingestion_model: (typeof ingestion_model === "string" && ingestion_model.trim()) ? ingestion_model.trim() : null,
      min_score: minScoreVal,
    });
    res.json({ success: true, data: s });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e?.message || "Failed to update settings" });
  }
});

export default router;
