import express from "express";
import type { Request, Response, NextFunction } from "express";
import cors from "cors";
import compression from "compression";
import routes from "./routes/index.ts";
import logsRoutes from "./routes/logs.routes.ts";
import mediaRoutes from "./routes/media.routes.ts";
import collectionsRoutes from "./routes/collections.routes.ts";
import costRoutes from "./routes/cost.routes.ts";
import promptsRoutes from "./routes/prompts.routes.ts";
import userModelSettingsRoutes from "./routes/user-model-settings.routes.ts";
import adminRoutes from "./routes/admin.routes.ts";
import adminAnalyticsRoutes from "./routes/adminAnalytics.routes.ts";
import analyticsRoutes from "./routes/analytics.routes.ts";
import { authenticateUser, requireAdmin } from "./middleware/auth.middleware";
import { FILE_SIZE_LIMIT } from "./utils/constants";

const app = express();

// Add response compression middleware (before other middleware)
app.use(
  compression({
    level: 6, // Balance between speed and compression
    threshold: 1024, // Only compress responses > 1KB
    filter: (req: Request, res: Response) => {
      // Don't compress if client doesn't support it
      if (req.headers["x-no-compression"]) {
        return false;
      }
      // Compress JSON and text responses
      const contentType = res.getHeader("content-type") as string;
      return (
        !contentType ||
        contentType.includes("application/json") ||
        contentType.includes("text/")
      );
    },
  })
);

// CORS configuration - allow frontend to connect
app.use(
  cors({
    origin: "*",
    credentials: false,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Increase payload size limits for large file uploads
// 50MB for JSON and URL-encoded bodies
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.get("/api/health", (_: Request, res: Response): void => {
  res.json({
    success: true,
    message: "Snoolink Studio Backend is running",
    timestamp: new Date().toISOString(),
  });
});

// Mount logs routes first (before other routes) to ensure they're matched correctly
// Logs routes are public and don't require authentication
app.use("/api/logs", logsRoutes);
// Mount media routes at /api/media
app.use("/api/media", mediaRoutes);
// Mount collections routes at /api/collections
app.use("/api/collections", collectionsRoutes);
// Mount cost tracking routes at /api/cost
app.use("/api/cost", costRoutes);
// Prompts (list + create) and user model settings
app.use("/api/prompts", promptsRoutes);
app.use("/api/user-model-settings", userModelSettingsRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/admin/analytics", authenticateUser, requireAdmin, adminAnalyticsRoutes);
app.use("/api/analytics", analyticsRoutes);
// Mount other routes at /api
app.use("/api", ...routes);

// Error handling middleware
app.use(
  (error: Error, req: Request, res: Response, _next: NextFunction): void => {
    console.error("Error:", error);
    
    // Handle multer errors specifically
    if (error.name === "MulterError") {
      const multerError = error as any;
      if (multerError.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          success: false,
          error: `File too large. Maximum file size is ${FILE_SIZE_LIMIT / (1024 * 1024)}MB`,
        });
      }
      if (multerError.code === "LIMIT_FILE_COUNT") {
        return res.status(413).json({
          success: false,
          error: "Too many files. Maximum files per request exceeded.",
        });
      }
      if (multerError.code === "LIMIT_UNEXPECTED_FILE") {
        return res.status(400).json({
          success: false,
          error: "Unexpected file field name.",
        });
      }
      return res.status(400).json({
        success: false,
        error: `Upload error: ${multerError.message}`,
      });
    }
    
    // Handle payload too large errors
    if (error.message.includes("payload") || error.message.includes("too large")) {
      return res.status(413).json({
        success: false,
        error: "Request payload too large. Try uploading fewer or smaller images.",
      });
    }
    
    res.status(500).json({
      success: false,
      error: `Internal server error: ${error.message}`,
    });
  }
);

app.use((_req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    error: "Route not found",
  });
});

export default app;
