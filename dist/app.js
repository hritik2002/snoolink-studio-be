import express from "express";
import cors from "cors";
import routes from "./routes/index.ts";
const app = express();
// CORS configuration - allow frontend to connect
app.use(cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.get("/api/health", (_, res) => {
    res.json({
        success: true,
        message: "Snoolink Studio Backend is running",
        timestamp: new Date().toISOString(),
    });
});
app.use("/api", ...routes);
app.use((error, _req, res, _next) => {
    console.error("Error:", error);
    res.status(500).json({
        success: false,
        error: `Internal server error: ${error.message}`,
    });
});
app.use((_req, res) => {
    res.status(404).json({
        success: false,
        error: "Route not found",
    });
});
export default app;
