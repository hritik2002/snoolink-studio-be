import express from "express";
import type { Request, Response, NextFunction } from "express";
import cors from "cors";
import routes from "./routes/index.ts";
import logsRoutes from "./routes/logs.routes.ts";
import { FILE_SIZE_LIMIT } from "./utils/constants";

const app = express();

// CORS configuration - allow frontend to connect
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
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

app.use("/api", ...routes);
app.use("/api/logs", logsRoutes);

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
