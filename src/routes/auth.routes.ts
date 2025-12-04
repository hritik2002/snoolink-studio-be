import { Router } from "express";
import { optionalAuth } from "../middleware/auth.middleware.ts";
import type { Request, Response } from "express";

const router = Router();

router.use(optionalAuth);

router.get("/me", (req: Request, res: Response) => {
  if (req.user) {
    return res.json({
      success: true,
      data: {
        id: req.user.id,
        email: req.user.email,
      },
    });
  }
  return res.status(401).json({
    success: false,
    error: "Not authenticated",
  });
});

export default router;

