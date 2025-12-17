import { Router } from "express";
import { authenticateUser } from "../middleware/auth.middleware.ts";
import ProfileController from "../controllers/profile.controller.ts";
import type { Request, Response } from "express";

const router = Router();
const profileController = new ProfileController();

router.use(authenticateUser);

router.get("/profile", async (req: Request, res: Response) => {
  try {
    const profile = await profileController.getProfile(req.user!.id);
    res.json({ success: true, data: profile });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put("/profile", async (req: Request, res: Response) => {
  try {
    const { name, email } = req.body;
    const updatedProfile = await profileController.updateProfile(
      req.user!.id,
      { name, email }
    );
    res.json({ success: true, data: updatedProfile });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Endpoint to ensure profile exists (called after OAuth login)
router.post("/profile/ensure", async (req: Request, res: Response) => {
  try {
    await profileController.ensureProfile(req.user!.id);
    res.json({ success: true, message: "Profile ensured" });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

