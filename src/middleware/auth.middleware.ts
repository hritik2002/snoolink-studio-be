import type { Request, Response, NextFunction } from "express";
import { createClient } from "@supabase/supabase-js";
import { CONFIG } from "../config";
import { isAdmin } from "../services/prompts.service";

const supabase = createClient(
  CONFIG.supabase.supabaseUrl,
  CONFIG.supabase.supabaseKey
);

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email?: string;
      };
    }
  }
}

export async function authenticateUser(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        error: "Missing or invalid authorization header",
      });
    }

    const token = authHeader.substring(7);

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({
        success: false,
        error: "Invalid or expired token",
      });
    }

    req.user = {
      id: user.id,
      email: user.email,
    };

    next();
  } catch (error: any) {
    return res.status(401).json({
      success: false,
      error: `Authentication failed: ${error.message}`,
    });
  }
}

export async function optionalAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      const {
        data: { user },
      } = await supabase.auth.getUser(token);

      if (user) {
        req.user = {
          id: user.id,
          email: user.email,
        };
      }
    }

    next();
  } catch (error) {
    next();
  }
}

/** Must run after authenticateUser. Returns 403 if req.user.email is not in ADMIN_EMAILS. */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user?.email) {
    return res.status(401).json({ success: false, error: "Unauthorized" });
  }
  if (!isAdmin(req.user.email)) {
    return res.status(403).json({ success: false, error: "Admin access required" });
  }
  next();
}

