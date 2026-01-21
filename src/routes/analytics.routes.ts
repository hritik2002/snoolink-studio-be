import { Router, Request, Response } from "express";
import { authenticateUser } from "../middleware/auth.middleware.js";
import { analyticsService } from "../services/analytics.service.js";

const router = Router();
router.use(authenticateUser);

/** POST /api/analytics/track – batch ingest from client or server. Body: { events: [ { name, properties?, ts? } ], source?: 'client'|'server' } */
router.post("/track", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { events, source = "client" } = req.body as {
      events?: Array<{ name: string; properties?: Record<string, unknown>; ts?: string }>;
      source?: "client" | "server";
    };
    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ success: false, error: "events array required" });
    }
    const s = source === "server" ? "server" : "client";
    for (const e of events.slice(0, 100)) {
      if (e?.name && typeof e.name === "string") {
        analyticsService.track(userId, e.name, e.properties || {}, s);
      }
    }
    return res.json({ success: true });
  } catch (e: unknown) {
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

/** GET /api/analytics/overview – high-level counts for dashboard. Query: startDate, endDate (ISO) */
router.get("/overview", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { startDate, endDate } = req.query;
    const start = startDate && !Number.isNaN(Date.parse(startDate as string)) ? new Date(startDate as string) : undefined;
    const end = endDate && !Number.isNaN(Date.parse(endDate as string)) ? new Date(endDate as string) : undefined;
    const data = await analyticsService.getOverview(userId, start, end);
    return res.json({ success: true, data });
  } catch (e: unknown) {
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

/** GET /api/analytics/summary – by-day and by-event. Query: startDate, endDate */
router.get("/summary", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { startDate, endDate } = req.query;
    const start = startDate && !Number.isNaN(Date.parse(startDate as string)) ? new Date(startDate as string) : undefined;
    const end = endDate && !Number.isNaN(Date.parse(endDate as string)) ? new Date(endDate as string) : undefined;
    const data = await analyticsService.getSummary(userId, start, end);
    return res.json({ success: true, data });
  } catch (e: unknown) {
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

/** GET /api/analytics/events – paginated raw events. Query: startDate, endDate, eventName, limit, offset */
router.get("/events", async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { startDate, endDate, eventName, limit, offset } = req.query;
    const start = startDate && !Number.isNaN(Date.parse(startDate as string)) ? new Date(startDate as string) : undefined;
    const end = endDate && !Number.isNaN(Date.parse(endDate as string)) ? new Date(endDate as string) : undefined;
    const data = await analyticsService.getEvents(userId, {
      start,
      end,
      eventName: eventName as string | undefined,
      limit: limit ? parseInt(limit as string, 10) : 50,
      offset: offset ? parseInt(offset as string, 10) : 0,
    });
    return res.json({ success: true, ...data });
  } catch (e: unknown) {
    return res.status(500).json({ success: false, error: (e as Error).message });
  }
});

export default router;
