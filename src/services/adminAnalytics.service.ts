import { createClient } from "@supabase/supabase-js";
import { CONFIG } from "../config";

const MAX_ROWS = 50000;

type Row = { user_id: string; event_name: string; created_at: string; properties?: Record<string, unknown> };

/**
 * Admin-only: platform-wide analytics over user_analytics_events.
 * Uses service role (bypasses RLS). Call only after requireAdmin.
 */
class AdminAnalyticsService {
  private supabase = createClient(
    CONFIG.supabase.supabaseUrl,
    CONFIG.supabase.supabaseKey
  );

  private async fetchEvents(start?: Date, end?: Date): Promise<Row[]> {
    let q = this.supabase
      .from("user_analytics_events")
      .select("user_id, event_name, created_at, properties")
      .order("created_at", { ascending: true })
      .limit(MAX_ROWS);
    if (start) q = q.gte("created_at", start.toISOString());
    if (end) q = q.lte("created_at", end.toISOString());
    const { data, error } = await q;
    if (error) {
      console.error("[adminAnalytics] fetch error:", error);
      return [];
    }
    return (data || []) as Row[];
  }

  /** Platform KPI overview for the period. */
  async getPlatformOverview(start?: Date, end?: Date): Promise<{
    activeUsers: number;
    totalEvents: number;
    searches: number;
    uploads: { images: number; videos: number };
    collectionsCreated: number;
    pageViews: number;
    featureUse: number;
    topEventNames: { name: string; count: number }[];
    bySource: { client: number; server: number };
  }> {
    // We need source for bySource; add to select
    let q = this.supabase
      .from("user_analytics_events")
      .select("user_id, event_name, created_at, properties, source")
      .order("created_at", { ascending: true })
      .limit(MAX_ROWS);
    if (start) q = q.gte("created_at", start.toISOString());
    if (end) q = q.lte("created_at", end.toISOString());
    const { data, error } = await q;
    if (error) {
      console.error("[adminAnalytics] getPlatformOverview error:", error);
      return this.emptyPlatformOverview();
    }
    const rows = (data || []) as (Row & { source?: string })[];
    const userIds = new Set<string>();
    let searches = 0, images = 0, videos = 0, collectionsCreated = 0, pageViews = 0, featureUse = 0;
    const byName: Record<string, number> = {};
    const bySource: Record<string, number> = { client: 0, server: 0 };
    const isSearch = (n: string) =>
      n === "search_completed_image" || n === "search_completed_video" || n === "search_completed_multi";

    rows.forEach((r) => {
      userIds.add(r.user_id);
      byName[r.event_name] = (byName[r.event_name] || 0) + 1;
      const src = r.source === "client" ? "client" : "server";
      bySource[src] = (bySource[src] || 0) + 1;
      if (isSearch(r.event_name)) searches += 1;
      else if (r.event_name === "upload_queued") {
        const p = r.properties as { type?: string; count?: number } | undefined;
        const c = typeof p?.count === "number" ? p.count : 1;
        if (p?.type === "video") videos += c;
        else images += c;
      }
      else if (r.event_name === "collection_created") collectionsCreated += 1;
      else if (r.event_name === "page_view") pageViews += 1;
      else if (r.event_name === "feature_use") featureUse += 1;
    });

    const topEventNames = Object.entries(byName)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);

    return {
      activeUsers: userIds.size,
      totalEvents: rows.length,
      searches,
      uploads: { images, videos },
      collectionsCreated,
      pageViews,
      featureUse,
      topEventNames,
      bySource: { client: bySource.client || 0, server: bySource.server || 0 },
    };
  }

  /** Daily trends for charts. */
  async getPlatformTrends(start?: Date, end?: Date): Promise<{
    byDay: Array<{
      date: string;
      activeUsers: number;
      searches: number;
      uploads: number;
      pageViews: number;
      totalEvents: number;
    }>;
  }> {
    const rows = await this.fetchEvents(start, end);
    const byDay: Record<string, { users: Set<string>; searches: number; uploads: number; pageViews: number; total: number }> = {};
    const isSearch = (n: string) =>
      n === "search_completed_image" || n === "search_completed_video" || n === "search_completed_multi";

    rows.forEach((r) => {
      const d = new Date(r.created_at).toISOString().split("T")[0];
      if (!byDay[d]) byDay[d] = { users: new Set(), searches: 0, uploads: 0, pageViews: 0, total: 0 };
      byDay[d].users.add(r.user_id);
      byDay[d].total += 1;
      if (isSearch(r.event_name)) byDay[d].searches += 1;
      else if (r.event_name === "upload_queued") byDay[d].uploads += 1;
      else if (r.event_name === "page_view") byDay[d].pageViews += 1;
    });

    const byDayArr = Object.entries(byDay)
      .map(([date, v]) => ({
        date,
        activeUsers: v.users.size,
        searches: v.searches,
        uploads: v.uploads,
        pageViews: v.pageViews,
        totalEvents: v.total,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return { byDay: byDayArr };
  }

  /** Per-user metrics for segmentation. Paginated. */
  async getUsersList(
    start?: Date,
    end?: Date,
    limit = 50,
    offset = 0
  ): Promise<{
    users: Array<{
      userId: string;
      email?: string | null;
      name?: string | null;
      totalEvents: number;
      searches: number;
      uploads: number;
      collectionsCreated: number;
      pageViews: number;
      firstSeen: string;
      lastSeen: string;
    }>;
    total: number;
    hasMore: boolean;
  }> {
    const rows = await this.fetchEvents(start, end);
    const byUser: Record<
      string,
      { events: number; searches: number; uploads: number; collections: number; pageViews: number; first: string; last: string }
    > = {};
    const isSearch = (n: string) =>
      n === "search_completed_image" || n === "search_completed_video" || n === "search_completed_multi";

    rows.forEach((r) => {
      if (!byUser[r.user_id])
        byUser[r.user_id] = { events: 0, searches: 0, uploads: 0, collections: 0, pageViews: 0, first: r.created_at, last: r.created_at };
      const u = byUser[r.user_id];
      u.events += 1;
      if (r.created_at < u.first) u.first = r.created_at;
      if (r.created_at > u.last) u.last = r.created_at;
      if (isSearch(r.event_name)) u.searches += 1;
      else if (r.event_name === "upload_queued") u.uploads += 1;
      else if (r.event_name === "collection_created") u.collections += 1;
      else if (r.event_name === "page_view") u.pageViews += 1;
    });

    const sorted = Object.entries(byUser)
      .map(([userId, v]) => ({
        userId,
        totalEvents: v.events,
        searches: v.searches,
        uploads: v.uploads,
        collectionsCreated: v.collections,
        pageViews: v.pageViews,
        firstSeen: v.first,
        lastSeen: v.last,
      }))
      .sort((a, b) => b.totalEvents - a.totalEvents);

    const total = sorted.length;
    const slice = sorted.slice(offset, offset + limit);
    const userIds = slice.map((u) => u.userId);

    // Enrich with profile (email, name) when available
    let profiles: Record<string, { email?: string | null; name?: string | null }> = {};
    if (userIds.length > 0) {
      try {
        const { data: p } = await this.supabase
          .from("profiles")
          .select("id, email, name")
          .in("id", userIds);
        if (p && Array.isArray(p)) {
          p.forEach((r: { id: string; email?: string | null; name?: string | null }) => {
            profiles[r.id] = { email: r.email ?? null, name: r.name ?? null };
          });
        }
      } catch {
        // profiles may not exist or lack columns
      }
      // Fallback: try auth.admin.getUserById for each? Too many calls. Skip.
    }

    const users = slice.map((u) => ({
      ...u,
      email: profiles[u.userId]?.email ?? null,
      name: profiles[u.userId]?.name ?? null,
    }));

    return { users, total, hasMore: offset + limit < total };
  }

  private emptyPlatformOverview() {
    return {
      activeUsers: 0,
      totalEvents: 0,
      searches: 0,
      uploads: { images: 0, videos: 0 },
      collectionsCreated: 0,
      pageViews: 0,
      featureUse: 0,
      topEventNames: [] as { name: string; count: number }[],
      bySource: { client: 0, server: 0 },
    };
  }
}

export const adminAnalyticsService = new AdminAnalyticsService();
