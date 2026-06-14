import { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseClient } from "../lib/supabase.client";

export interface LogEntry {
  user_id: string;
  user_query: string;
  enhanced_query: string | null;
  response: any | null;
  error: string | null;
  endpoint: string;
  method: string;
  response_time_ms?: number;
  created_at?: string;
}

export class LoggingService {
  private supabaseClient: SupabaseClient;

  constructor() {
    this.supabaseClient = createSupabaseClient();
  }

  /**
   * Logs an API request/response asynchronously without blocking the main request.
   * Uses fire-and-forget pattern for maximum performance.
   */
  logRequest(logEntry: LogEntry): void {
    // Fire-and-forget: don't await, don't block the request
    this.logRequestAsync(logEntry).catch((error) => {
      // Silently handle logging errors to prevent breaking the API
      // Only log to console in development
      if (process.env.NODE_ENV !== "production") {
        console.error("Failed to log request:", error);
      }
    });
  }

  /**
   * Internal async method that actually performs the logging
   */
  private async logRequestAsync(logEntry: LogEntry): Promise<void> {
    try {
      const { error } = await this.supabaseClient
        .from("api_logs")
        .insert({
          user_id: logEntry.user_id,
          user_query: logEntry.user_query,
          enhanced_query: logEntry.enhanced_query,
          response: logEntry.response,
          error: logEntry.error,
          endpoint: logEntry.endpoint,
          method: logEntry.method,
          response_time_ms: logEntry.response_time_ms,
          created_at: logEntry.created_at || new Date().toISOString(),
        });

      if (error) {
        throw error;
      }
    } catch (error) {
      // Re-throw to be caught by the caller
      throw error;
    }
  }

  /**
   * Retrieves logs with optional filtering
   */
  async getLogs(options: {
    userId?: string;
    limit?: number;
    offset?: number;
    startDate?: string;
    endDate?: string;
  }): Promise<{ data: LogEntry[]; count: number }> {
    let query = this.supabaseClient
      .from("api_logs")
      .select("*", { count: "exact" });

    if (options.userId) {
      query = query.eq("user_id", options.userId);
    }

    if (options.startDate) {
      query = query.gte("created_at", options.startDate);
    }

    if (options.endDate) {
      query = query.lte("created_at", options.endDate);
    }

    query = query.order("created_at", { ascending: false });

    if (options.limit) {
      query = query.limit(options.limit);
    }

    if (options.offset) {
      query = query.range(
        options.offset,
        options.offset + (options.limit || 100) - 1
      );
    }

    const { data, error, count } = await query;

    if (error) {
      throw error;
    }

    return {
      data: (data as LogEntry[]) || [],
      count: count || 0,
    };
  }

  /**
   * Gets log statistics
   */
  async getLogStats(userId?: string): Promise<{
    total: number;
    errors: number;
    avgResponseTime: number;
  }> {
    let query = this.supabaseClient
      .from("api_logs")
      .select("error, response_time_ms", { count: "exact" });

    if (userId) {
      query = query.eq("user_id", userId);
    }

    const { data, error, count } = await query;

    if (error) {
      throw error;
    }

    const logs = (data || []) as Array<{
      error: string | null;
      response_time_ms: number | null;
    }>;

    const errors = logs.filter((log) => log.error !== null).length;
    const responseTimes = logs
      .map((log) => log.response_time_ms)
      .filter((time): time is number => time !== null && time !== undefined);

    const avgResponseTime =
      responseTimes.length > 0
        ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
        : 0;

    return {
      total: count || 0,
      errors,
      avgResponseTime: Math.round(avgResponseTime * 100) / 100,
    };
  }
}

export const loggingService = new LoggingService();

