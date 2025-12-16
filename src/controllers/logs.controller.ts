import { loggingService } from "../services/logging.service";

class LogsController {
  /**
   * Get all logs with optional filtering
   */
  async getLogs(req: any, res: any) {
    try {
      const {
        limit = 100,
        offset = 0,
        startDate,
        endDate,
      } = req.query;

      // Only allow users to see their own logs unless they're admin
      const userId = req.user?.id;

      const { data, count } = await loggingService.getLogs({
        userId,
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
   */
  async getLogStats(req: any, res: any) {
    try {
      const userId = req.user?.id;

      const stats = await loggingService.getLogStats(userId);

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

