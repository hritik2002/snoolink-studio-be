import { createClient } from "@supabase/supabase-js";
import { CONFIG } from "../config";

const BATCH_SIZE = 50;
const FLUSH_MS = 2500;

export type AnalyticsEventSource = "client" | "server";

interface BufferedEvent {
  user_id: string;
  event_name: string;
  properties: Record<string, unknown>;
  source: AnalyticsEventSource;
  created_at: string;
}

/**
 * Lightweight, batched user analytics. Buffers in memory and flushes to Supabase.
 * Non-blocking: track() returns immediately. Failures are logged, not thrown.
 */
class AnalyticsService {
  private buffer: BufferedEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private supabase = createClient(
    CONFIG.supabase.supabaseUrl,
    CONFIG.supabase.supabaseKey
  );

  /** Enqueue an event. Flush is scheduled by size or interval. */
  track(
    userId: string,
    eventName: string,
    properties?: Record<string, unknown>,
    source: AnalyticsEventSource = "server"
  ): void {
    if (!userId || !eventName) return;
    const created_at =
      (properties?.ts as string) && isValidISO(properties.ts)
        ? (properties.ts as string)
        : new Date().toISOString();
    const { ts: _ts, ...rest } = properties || {};
    this.buffer.push({
      user_id: userId,
      event_name: eventName,
      properties: rest && Object.keys(rest).length > 0 ? rest : {},
      source,
      created_at,
    });
    this.scheduleFlush();
  }

  /** Flush immediately. Called on interval, when buffer is full, or from routes. */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const toInsert = this.buffer.splice(0, BATCH_SIZE);
    this.clearFlushTimer();
    try {
      const { error } = await this.supabase
        .from("user_analytics_events")
        .insert(
          toInsert.map((e) => ({
            user_id: e.user_id,
            event_name: e.event_name,
            properties: e.properties,
            source: e.source,
            created_at: e.created_at,
          }))
        );
      if (error) console.error("[analytics] insert error:", error.message);
    } catch (e) {
      console.error("[analytics] flush error:", e);
    }
    if (this.buffer.length > 0) this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.buffer.length >= BATCH_SIZE) {
      this.flush();
      return;
    }
    if (!this.flushTimer)
      this.flushTimer = setInterval(() => this.flush(), FLUSH_MS);
  }

  private clearFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  // --- Read APIs for user dashboard ---

  async getOverview(
    userId: string,
    start?: Date,
    end?: Date
  ): Promise<{
    totalEvents: number;
    searches: number;
    uploads: { images: number; videos: number };
    collectionsCreated: number;
    pageViews: number;
    topEventNames: { name: string; count: number }[];
  }> {
    let q = this.supabase
      .from("user_analytics_events")
      .select("event_name, created_at, properties")
      .eq("user_id", userId);
    if (start) q = q.gte("created_at", start.toISOString());
    if (end) q = q.lte("created_at", end.toISOString());
    const { data, error } = await q;
    if (error) {
      console.error("[analytics] getOverview error:", error);
      return this.emptyOverview();
    }
    const rows = (data || []) as Array<{ event_name: string; created_at: string; properties?: Record<string, unknown> }>;
    const searches = rows.filter(
      (r) =>
        r.event_name === "search_completed_image" ||
        r.event_name === "search_completed_video" ||
        r.event_name === "search_completed_multi"
    ).length;
    let images = 0,
      videos = 0;
    rows.forEach((r) => {
      if (r.event_name === "upload_queued") {
        const p = r.properties as { type?: string; count?: number } | undefined;
        const c = typeof p?.count === "number" ? p.count : 1;
        if (p?.type === "video") videos += c;
        else images += c;
      }
    });
    const collectionsCreated = rows.filter(
      (r) => r.event_name === "collection_created"
    ).length;
    const pageViews = rows.filter((r) => r.event_name === "page_view").length;
    const byName: Record<string, number> = {};
    rows.forEach((r) => {
      byName[r.event_name] = (byName[r.event_name] || 0) + 1;
    });
    const topEventNames = Object.entries(byName)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    return {
      totalEvents: rows.length,
      searches,
      uploads: { images, videos },
      collectionsCreated,
      pageViews,
      topEventNames,
    };
  }

  async getSummary(
    userId: string,
    start?: Date,
    end?: Date
  ): Promise<{
    byDay: Array<{ date: string; searches: number; uploads: number; pageViews: number }>;
    byEvent: Record<string, number>;
  }> {
    let q = this.supabase
      .from("user_analytics_events")
      .select("event_name, created_at, properties")
      .eq("user_id", userId);
    if (start) q = q.gte("created_at", start.toISOString());
    if (end) q = q.lte("created_at", end.toISOString());
    const { data, error } = await q;
    if (error) {
      console.error("[analytics] getSummary error:", error);
      return { byDay: [], byEvent: {} };
    }
    const rows = data || [];
    const byEvent: Record<string, number> = {};
    const byDay: Record<
      string,
      { searches: number; uploads: number; pageViews: number }
    > = {};
    const isSearch = (n: string) =>
      n === "search_completed_image" ||
      n === "search_completed_video" ||
      n === "search_completed_multi";
    const isUpload = (n: string) => n === "upload_queued";
    const isPageView = (n: string) => n === "page_view";
    rows.forEach((r) => {
      byEvent[r.event_name] = (byEvent[r.event_name] || 0) + 1;
      const d = new Date(r.created_at).toISOString().split("T")[0];
      if (!byDay[d]) byDay[d] = { searches: 0, uploads: 0, pageViews: 0 };
      if (isSearch(r.event_name)) byDay[d].searches += 1;
      else if (isUpload(r.event_name)) byDay[d].uploads += 1;
      else if (isPageView(r.event_name)) byDay[d].pageViews += 1;
    });
    const byDayArr = Object.entries(byDay)
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return { byDay: byDayArr, byEvent };
  }

  async getEvents(
    userId: string,
    opts: {
      start?: Date;
      end?: Date;
      eventName?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{ data: BufferedEvent[]; total: number; hasMore: boolean }> {
    const { start, end, eventName, limit = 50, offset = 0 } = opts;
    let q = this.supabase
      .from("user_analytics_events")
      .select("*", { count: "exact" })
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (start) q = q.gte("created_at", start.toISOString());
    if (end) q = q.lte("created_at", end.toISOString());
    if (eventName) q = q.eq("event_name", eventName);
    q = q.range(offset, offset + limit - 1);
    const { data, error, count } = await q;
    if (error) {
      console.error("[analytics] getEvents error:", error);
      return { data: [], total: 0, hasMore: false };
    }
    const list = (data || []) as BufferedEvent[];
    const total = count ?? 0;
    return { data: list, total, hasMore: total > offset + limit };
  }

  private emptyOverview() {
    return {
      totalEvents: 0,
      searches: 0,
      uploads: { images: 0, videos: 0 },
      collectionsCreated: 0,
      pageViews: 0,
      topEventNames: [] as { name: string; count: number }[],
    };
  }
}

function isValidISO(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const d = new Date(v);
  return !isNaN(d.getTime());
}

export const analyticsService = new AnalyticsService();
