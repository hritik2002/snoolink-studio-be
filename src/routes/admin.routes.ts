import { Router, Request, Response } from "express";
import { authenticateUser } from "../middleware/auth.middleware";
import { isAdmin } from "../services/prompts.service";

const router = Router();

router.use(authenticateUser);

/** GET /api/admin/check - Returns { isAdmin: boolean } for the current user. */
router.get("/check", (req: Request, res: Response) => {
  res.json({ success: true, isAdmin: isAdmin(req.user?.email) });
});

export default router;
