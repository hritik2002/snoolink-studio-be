import express from "express";
import type { Request, Response, NextFunction } from "express";
import routes from "./routes/index.ts";

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", ...routes);

app.use(
  (error: Error, _req: Request, res: Response, _next: NextFunction): void => {
    res.status(500).json({
      success: false,
      error: `Internal server error: ${error.message}`,
    });
  }
);

app.get("/api/health", (_: Request, res: Response): void => {
  res.json({
    success: true,
    message: "Snoolink Studio Backend is running",
    timestamp: new Date().toISOString(),
  });
});

export default app;
