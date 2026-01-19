import { Router, Request, Response } from "express";
import { authenticateUser, requireAdmin } from "../middleware/auth.middleware";
import { promptsService } from "../services/prompts.service";

const router = Router();

router.use(authenticateUser);

/** GET /api/prompts - List all prompts (for Settings dropdown). Any authenticated user. */
router.get("/", async (_req: Request, res: Response) => {
  try {
    const list = await promptsService.list();
    res.json({ success: true, data: list });
  } catch (e: any) {
    res.status(500).json({ success: false, error: e?.message || "Failed to list prompts" });
  }
});

/** POST /api/prompts - Create a new prompt. Admin only. Body: { model, prompt }. */
router.post("/", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { model, prompt } = req.body;
    if (!model || typeof model !== "string" || !model.trim()) {
      return res.status(400).json({ success: false, error: "model is required" });
    }
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return res.status(400).json({ success: false, error: "prompt is required" });
    }
    const creator = req.user!.email || "unknown";
    const row = await promptsService.create(model.trim(), prompt.trim(), creator);
    res.status(201).json({ success: true, data: row });
  } catch (e: any) {
    if (e?.message?.includes("already exists")) {
      return res.status(409).json({ success: false, error: e.message });
    }
    res.status(500).json({ success: false, error: e?.message || "Failed to create prompt" });
  }
});

export default router;
