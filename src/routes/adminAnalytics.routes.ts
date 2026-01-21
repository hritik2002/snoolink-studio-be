import { Router, Request, Response } from "express";
import { adminAnalyticsService } from "../services/adminAnalytics.service.js";

const router = Router();

/** GET /api/admin/analytics/overview – platform KPIs. Query: startDate, endDate (ISO) */
router.get("/overview", async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate && !Number.isNaN(Date.parse(startDate as string)) ? new Date(startDate as string) : undefined;
    const end = endDate && !Number.isNaN(Date.parse(endDate as string)) ? new Date(endDate as string) : undefined;
    const data = await adminAnalyticsService.getPlatformOverview(start, end);
    return res.json({ success: true, data });
  } catch (e: unknown) {
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

/** GET /api/admin/analytics/trends – by-day series. Query: startDate, endDate */
router.get("/trends", async (req: Request, res: Response) => {
  try {
    const { startDate, endDate } = req.query;
    const start = startDate && !Number.isNaN(Date.parse(startDate as string)) ? new Date(startDate as string) : undefined;
    const end = endDate && !Number.isNaN(Date.parse(endDate as string)) ? new Date(endDate as string) : undefined;
    const data = await adminAnalyticsService.getPlatformTrends(start, end);
    return res.json({ success: true, data });
  } catch (e: unknown) {
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

/** GET /api/admin/analytics/users – per-user metrics. Query: startDate, endDate, limit, offset */
router.get("/users", async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, limit, offset } = req.query;
    const start = startDate && !Number.isNaN(Date.parse(startDate as string)) ? new Date(startDate as string) : undefined;
    const end = endDate && !Number.isNaN(Date.parse(endDate as string)) ? new Date(endDate as string) : undefined;
    const data = await adminAnalyticsService.getUsersList(
      start,
      end,
      limit ? parseInt(limit as string, 10) : 50,
      offset ? parseInt(offset as string, 10) : 0
    );
    return res.json({ success: true, ...data });
  } catch (e: unknown) {
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

/** GET /api/admin/analytics/search-queries – prompt/queries by user with expanded query. Query: startDate, endDate, limit, offset */
router.get("/search-queries", async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, limit, offset } = req.query;
    const start = startDate && !Number.isNaN(Date.parse(startDate as string)) ? new Date(startDate as string) : undefined;
    const end = endDate && !Number.isNaN(Date.parse(endDate as string)) ? new Date(endDate as string) : undefined;
    const data = await adminAnalyticsService.getSearchQueries(
      start,
      end,
      limit ? parseInt(limit as string, 10) : 50,
      offset ? parseInt(offset as string, 10) : 0
    );
    return res.json({ success: true, ...data });
  } catch (e: unknown) {
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

export default router;
