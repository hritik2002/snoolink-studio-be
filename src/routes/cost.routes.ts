import { Router, Request, Response } from "express";
import { authenticateUser } from "../middleware/auth.middleware.js";
import { CostTrackingService } from "../services/costTracking.service.js";

const router = Router();
const costTrackingService = new CostTrackingService();

// All routes require authentication
router.use(authenticateUser);

/**
 * GET /api/cost/export
 * Export cost data in JSON format with filtering options
 * 
 * Query Parameters:
 * - startDate: ISO date string (optional)
 * - endDate: ISO date string (optional)
 * - operationType: string (optional) - filter by operation type
 * - model: string (optional) - filter by model
 * - apiType: string (optional) - filter by API type (chat_completion, embedding, vision)
 * - includeFailed: boolean (optional, default: false) - include failed API calls
 * - limit: number (optional, default: 1000) - max records to return
 * - offset: number (optional, default: 0) - pagination offset
 * - format: string (optional, default: 'detailed') - 'detailed' or 'summary'
 */
router.get("/export", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const {
      startDate,
      endDate,
      operationType,
      model,
      apiType,
      includeFailed,
      limit,
      offset,
      format = "detailed",
    } = req.query;

    // Parse dates
    const start = startDate ? new Date(startDate as string) : undefined;
    const end = endDate ? new Date(endDate as string) : undefined;

    // Validate dates
    if (start && isNaN(start.getTime())) {
      return res.status(400).json({
        success: false,
        error: "Invalid startDate format. Use ISO 8601 format (e.g., 2024-01-01T00:00:00Z)",
      });
    }
    if (end && isNaN(end.getTime())) {
      return res.status(400).json({
        success: false,
        error: "Invalid endDate format. Use ISO 8601 format (e.g., 2024-12-31T23:59:59Z)",
      });
    }

    // Parse boolean
    const includeFailedBool = includeFailed === "true" || includeFailed === true;

    // Parse pagination
    const limitNum = limit ? parseInt(limit as string, 10) : 1000;
    const offsetNum = offset ? parseInt(offset as string, 10) : 0;

    if (limitNum < 1 || limitNum > 10000) {
      return res.status(400).json({
        success: false,
        error: "Limit must be between 1 and 10000",
      });
    }

    if (format === "summary") {
      // Return summary statistics
      const statistics = await costTrackingService.getCostStatistics(
        userId,
        start,
        end
      );

      return res.json({
        success: true,
        format: "summary",
        filters: {
          startDate: start?.toISOString(),
          endDate: end?.toISOString(),
        },
        data: statistics,
        exportedAt: new Date().toISOString(),
      });
    } else {
      // Return detailed records
      const exportData = await costTrackingService.exportCostData(userId, {
        startDate: start,
        endDate: end,
        operationType: operationType as string | undefined,
        model: model as string | undefined,
        apiType: apiType as string | undefined,
        includeFailed: includeFailedBool,
        limit: limitNum,
        offset: offsetNum,
      });

      return res.json({
        success: true,
        format: "detailed",
        filters: {
          startDate: start?.toISOString(),
          endDate: end?.toISOString(),
          operationType,
          model,
          apiType,
          includeFailed: includeFailedBool,
        },
        pagination: {
          limit: exportData.limit,
          offset: exportData.offset,
          total: exportData.total,
          hasMore: exportData.hasMore,
        },
        data: exportData.data,
        exportedAt: new Date().toISOString(),
      });
    }
  } catch (error: any) {
    console.error("Error exporting cost data:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to export cost data",
    });
  }
});

/**
 * GET /api/cost/summary
 * Get cost summary for the authenticated user
 * 
 * Query Parameters:
 * - startDate: ISO date string (optional)
 * - endDate: ISO date string (optional)
 */
router.get("/summary", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { startDate, endDate } = req.query;

    const start = startDate ? new Date(startDate as string) : undefined;
    const end = endDate ? new Date(endDate as string) : undefined;

    if (start && isNaN(start.getTime())) {
      return res.status(400).json({
        success: false,
        error: "Invalid startDate format",
      });
    }
    if (end && isNaN(end.getTime())) {
      return res.status(400).json({
        success: false,
        error: "Invalid endDate format",
      });
    }

    const summary = await costTrackingService.getUserCostSummary(
      userId,
      start,
      end
    );

    return res.json({
      success: true,
      filters: {
        startDate: start?.toISOString(),
        endDate: end?.toISOString(),
      },
      data: summary,
    });
  } catch (error: any) {
    console.error("Error fetching cost summary:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch cost summary",
    });
  }
});

/**
 * GET /api/cost/statistics
 * Get detailed cost statistics with breakdowns
 * 
 * Query Parameters:
 * - startDate: ISO date string (optional)
 * - endDate: ISO date string (optional)
 */
router.get("/statistics", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { startDate, endDate } = req.query;

    const start = startDate ? new Date(startDate as string) : undefined;
    const end = endDate ? new Date(endDate as string) : undefined;

    if (start && isNaN(start.getTime())) {
      return res.status(400).json({
        success: false,
        error: "Invalid startDate format",
      });
    }
    if (end && isNaN(end.getTime())) {
      return res.status(400).json({
        success: false,
        error: "Invalid endDate format",
      });
    }

    const statistics = await costTrackingService.getCostStatistics(
      userId,
      start,
      end
    );

    return res.json({
      success: true,
      filters: {
        startDate: start?.toISOString(),
        endDate: end?.toISOString(),
      },
      data: statistics,
    });
  } catch (error: any) {
    console.error("Error fetching cost statistics:", error);
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch cost statistics",
    });
  }
});

export default router;

