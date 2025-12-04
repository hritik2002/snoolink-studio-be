import { Router } from "express";
import { authenticateUser } from "../middleware/auth.middleware.ts";
import ProfileController from "../controllers/profile.controller.ts";
const router = Router();
const profileController = new ProfileController();
router.use(authenticateUser);
router.get("/profile", async (req, res) => {
    try {
        const profile = await profileController.getProfile(req.user.id);
        res.json({ success: true, data: profile });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
router.put("/profile", async (req, res) => {
    try {
        const { name, email } = req.body;
        const updatedProfile = await profileController.updateProfile(req.user.id, { name, email });
        res.json({ success: true, data: updatedProfile });
    }
    catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});
export default router;
