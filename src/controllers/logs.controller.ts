import { loggingService } from "../services/logging.service";

class LogsController {
  /**
   * Get all logs with optional filtering
   * Public endpoint - no authentication required
   */
  async getLogs(req: any, res: any) {
    try {
      const {
        limit = 100,
        offset = 0,
        startDate,
        endDate,
        userId, // Optional: filter by specific user_id if provided
      } = req.query;

      const { data, count } = await loggingService.getLogs({
        userId: userId as string | undefined,
        limit: parseInt(limit as string, 10),
        offset: parseInt(offset as string, 10),
        startDate: startDate as string | undefined,
        endDate: endDate as string | undefined,
      });

      res.json({
        success: true,
        data,
        pagination: {
          total: count,
          limit: parseInt(limit as string, 10),
          offset: parseInt(offset as string, 10),
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to retrieve logs",
      });
    }
  }

  /**
   * Get log statistics
   * Public endpoint - no authentication required
   */
  async getLogStats(req: any, res: any) {
    try {
      const { userId } = req.query; // Optional: filter by specific user_id if provided

      const stats = await loggingService.getLogStats(
        userId as string | undefined
      );

      res.json({
        success: true,
        data: stats,
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: error.message || "Failed to retrieve log statistics",
      });
    }
  }
}

export default new LogsController();

