import { createClient } from "@supabase/supabase-js";
import { CONFIG } from "../config";

/**
 * OpenAI Pricing (as of 2024)
 * Prices are per 1K tokens unless otherwise specified
 */
const OPENAI_PRICING = {
  // Chat Completions
  "gpt-4o-mini": {
    input: 0.15 / 1000, // $0.15 per 1M tokens
    output: 0.6 / 1000, // $0.60 per 1M tokens
    image: 0.0, // No additional cost for images in vision models
  },
  "gpt-4o": {
    input: 2.5 / 1000, // $2.50 per 1M tokens
    output: 10.0 / 1000, // $10.00 per 1M tokens
    image: 0.0,
  },
  "gpt-4-turbo": {
    input: 10.0 / 1000, // $10.00 per 1M tokens
    output: 30.0 / 1000, // $30.00 per 1M tokens
    image: 0.0,
  },
  // Embeddings
  "text-embedding-ada-002": {
    input: 0.1 / 1000, // $0.10 per 1M tokens
    output: 0.0,
    image: 0.0,
  },
  "text-embedding-3-small": {
    input: 0.02 / 1000, // $0.02 per 1M tokens
    output: 0.0,
    image: 0.0,
  },
  "text-embedding-3-large": {
    input: 0.13 / 1000, // $0.13 per 1M tokens
    output: 0.0,
    image: 0.0,
  },
} as const;

type ModelName = keyof typeof OPENAI_PRICING;
type APIType = "chat_completion" | "embedding" | "vision";
type OperationType =
  | "image_description"
  | "query_expansion"
  | "video_frame_description"
  | "video_summary"
  | "embedding"
  | "other";

interface CostTrackingData {
  userId: string;
  apiType: APIType;
  model: string;
  operationType: OperationType;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  endpoint?: string;
  context?: string;
  metadata?: Record<string, any>;
  requestId?: string;
  responseTimeMs?: number;
  success?: boolean;
  errorMessage?: string;
}

interface UsageData {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export class CostTrackingService {
  private supabaseClient;

  constructor() {
    this.supabaseClient = createClient(
      CONFIG.supabase.supabaseUrl,
      CONFIG.supabase.supabaseKey
    );
  }

  /**
   * Calculate cost based on model, tokens, and API type
   */
  private calculateCost(
    model: string,
    promptTokens: number = 0,
    completionTokens: number = 0,
    apiType: APIType
  ): { cost: number; breakdown: Record<string, number> } {
    const modelKey = model as ModelName;
    const pricing = OPENAI_PRICING[modelKey];

    if (!pricing) {
      console.warn(`Unknown model pricing for ${model}, using default`);
      return { cost: 0, breakdown: {} };
    }

    let inputCost = 0;
    let outputCost = 0;

    if (apiType === "embedding") {
      // Embeddings only charge for input tokens
      inputCost = (promptTokens / 1000) * pricing.input;
    } else {
      // Chat completions charge for both input and output
      inputCost = (promptTokens / 1000) * pricing.input;
      outputCost = (completionTokens / 1000) * pricing.output;
    }

    const totalCost = inputCost + outputCost;

    return {
      cost: totalCost,
      breakdown: {
        input_cost_usd: inputCost,
        output_cost_usd: outputCost,
        total_cost_usd: totalCost,
        input_tokens: promptTokens,
        output_tokens: completionTokens,
        model: model,
      },
    };
  }

  /**
   * Extract token usage from OpenAI API response
   */
  private extractUsage(usage: UsageData | undefined): {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } {
    return {
      promptTokens: usage?.prompt_tokens || 0,
      completionTokens: usage?.completion_tokens || 0,
      totalTokens: usage?.total_tokens || 0,
    };
  }

  /**
   * Track a chat completion API call
   */
  async trackChatCompletion(
    data: CostTrackingData,
    usage: UsageData | undefined
  ): Promise<void> {
    const { promptTokens, completionTokens, totalTokens } =
      this.extractUsage(usage);

    const { cost, breakdown } = this.calculateCost(
      data.model,
      promptTokens,
      completionTokens,
      data.apiType || "chat_completion"
    );

    await this.insertCostRecord({
      ...data,
      promptTokens,
      completionTokens,
      totalTokens,
      cost,
      breakdown,
    });
  }

  /**
   * Track an embedding API call
   */
  async trackEmbedding(
    data: CostTrackingData,
    usage: UsageData | undefined
  ): Promise<void> {
    const { promptTokens, totalTokens } = this.extractUsage(usage);

    const { cost, breakdown } = this.calculateCost(
      data.model,
      promptTokens,
      0,
      "embedding"
    );

    await this.insertCostRecord({
      ...data,
      promptTokens,
      completionTokens: 0,
      totalTokens,
      cost,
      breakdown,
    });
  }

  /**
   * Track a vision API call (chat completion with images)
   */
  async trackVision(
    data: CostTrackingData,
    usage: UsageData | undefined,
    imageCount: number = 1
  ): Promise<void> {
    const { promptTokens, completionTokens, totalTokens } =
      this.extractUsage(usage);

    const { cost, breakdown } = this.calculateCost(
      data.model,
      promptTokens,
      completionTokens,
      "vision"
    );

    // Add image count to metadata
    const enhancedMetadata = {
      ...data.metadata,
      image_count: imageCount,
    };

    await this.insertCostRecord({
      ...data,
      promptTokens,
      completionTokens,
      totalTokens,
      cost,
      breakdown,
      metadata: enhancedMetadata,
    });
  }

  /**
   * Insert cost record into database
   */
  private async insertCostRecord(data: {
    userId: string;
    apiType: APIType;
    model: string;
    operationType: OperationType;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost: number;
    breakdown: Record<string, any>;
    endpoint?: string;
    context?: string;
    metadata?: Record<string, any>;
    requestId?: string;
    responseTimeMs?: number;
    success?: boolean;
    errorMessage?: string;
  }): Promise<void> {
    try {
      const { error } = await this.supabaseClient
        .from("openai_cost_tracking")
        .insert({
          user_id: data.userId,
          api_type: data.apiType,
          model: data.model,
          operation_type: data.operationType,
          prompt_tokens: data.promptTokens,
          completion_tokens: data.completionTokens,
          total_tokens: data.totalTokens,
          cost_usd: data.cost,
          cost_breakdown: data.breakdown,
          endpoint: data.endpoint,
          context: data.context,
          metadata: data.metadata || {},
          request_id: data.requestId,
          response_time_ms: data.responseTimeMs,
          success: data.success !== false,
          error_message: data.errorMessage,
        });

      if (error) {
        console.error("Error inserting cost tracking record:", error);
        // Don't throw - cost tracking should not break the main flow
      }
    } catch (error) {
      console.error("Error in cost tracking:", error);
      // Don't throw - cost tracking should not break the main flow
    }
  }

  /**
   * Get cost summary for a user within a date range
   */
  async getUserCostSummary(
    userId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<{
    totalCost: number;
    totalTokens: number;
    operationBreakdown: Record<string, { cost: number; count: number }>;
    modelBreakdown: Record<string, { cost: number; count: number }>;
  }> {
    let query = this.supabaseClient
      .from("openai_cost_tracking")
      .select("cost_usd, total_tokens, operation_type, model")
      .eq("user_id", userId)
      .eq("success", true);

    if (startDate) {
      query = query.gte("created_at", startDate.toISOString());
    }
    if (endDate) {
      query = query.lte("created_at", endDate.toISOString());
    }

    const { data, error } = await query;

    if (error) {
      console.error("Error fetching cost summary:", error);
      return {
        totalCost: 0,
        totalTokens: 0,
        operationBreakdown: {},
        modelBreakdown: {},
      };
    }

    const totalCost = data.reduce(
      (sum, record) => sum + Number(record.cost_usd || 0),
      0
    );
    const totalTokens = data.reduce(
      (sum, record) => sum + Number(record.total_tokens || 0),
      0
    );

    const operationBreakdown: Record<string, { cost: number; count: number }> =
      {};
    const modelBreakdown: Record<string, { cost: number; count: number }> = {};

    data.forEach((record) => {
      const cost = Number(record.cost_usd || 0);
      const opType = record.operation_type || "unknown";
      const model = record.model || "unknown";

      operationBreakdown[opType] = {
        cost: (operationBreakdown[opType]?.cost || 0) + cost,
        count: (operationBreakdown[opType]?.count || 0) + 1,
      };

      modelBreakdown[model] = {
        cost: (modelBreakdown[model]?.cost || 0) + cost,
        count: (modelBreakdown[model]?.count || 0) + 1,
      };
    });

    return {
      totalCost,
      totalTokens,
      operationBreakdown,
      modelBreakdown,
    };
  }

  /**
   * Export cost data with filtering options
   */
  async exportCostData(
    userId: string,
    options: {
      startDate?: Date;
      endDate?: Date;
      operationType?: string;
      model?: string;
      apiType?: string;
      includeFailed?: boolean;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<{
    data: any[];
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  }> {
    const {
      startDate,
      endDate,
      operationType,
      model,
      apiType,
      includeFailed = false,
      limit = 1000,
      offset = 0,
    } = options;

    let query = this.supabaseClient
      .from("openai_cost_tracking")
      .select("*", { count: "exact" })
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (!includeFailed) {
      query = query.eq("success", true);
    }

    if (startDate) {
      query = query.gte("created_at", startDate.toISOString());
    }
    if (endDate) {
      query = query.lte("created_at", endDate.toISOString());
    }
    if (operationType) {
      query = query.eq("operation_type", operationType);
    }
    if (model) {
      query = query.eq("model", model);
    }
    if (apiType) {
      query = query.eq("api_type", apiType);
    }

    // Apply pagination
    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      console.error("Error exporting cost data:", error);
      throw new Error(`Failed to export cost data: ${error.message}`);
    }

    // Transform data to a more export-friendly format
    const exportData = (data || []).map((record) => ({
      id: record.id,
      timestamp: record.created_at,
      apiType: record.api_type,
      model: record.model,
      operationType: record.operation_type,
      tokens: {
        prompt: record.prompt_tokens,
        completion: record.completion_tokens,
        total: record.total_tokens,
      },
      cost: {
        usd: Number(record.cost_usd || 0),
        breakdown: record.cost_breakdown || {},
      },
      endpoint: record.endpoint,
      context: record.context,
      metadata: record.metadata || {},
      performance: {
        responseTimeMs: record.response_time_ms,
        success: record.success,
        errorMessage: record.error_message,
      },
      requestId: record.request_id,
    }));

    return {
      data: exportData,
      total: count || 0,
      limit,
      offset,
      hasMore: (count || 0) > offset + limit,
    };
  }

  /**
   * Get cost statistics for export
   */
  async getCostStatistics(
    userId: string,
    startDate?: Date,
    endDate?: Date
  ): Promise<{
    summary: {
      totalCost: number;
      totalTokens: number;
      totalCalls: number;
      successfulCalls: number;
      failedCalls: number;
      averageCostPerCall: number;
      averageTokensPerCall: number;
    };
    operationBreakdown: Record<string, { cost: number; count: number; avgCost: number }>;
    modelBreakdown: Record<string, { cost: number; count: number; avgCost: number }>;
    apiTypeBreakdown: Record<string, { cost: number; count: number; avgCost: number }>;
    dailyBreakdown: Array<{ date: string; cost: number; calls: number; tokens: number }>;
  }> {
    let query = this.supabaseClient
      .from("openai_cost_tracking")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (startDate) {
      query = query.gte("created_at", startDate.toISOString());
    }
    if (endDate) {
      query = query.lte("created_at", endDate.toISOString());
    }

    const { data, error } = await query;

    if (error) {
      console.error("Error fetching cost statistics:", error);
      throw new Error(`Failed to fetch cost statistics: ${error.message}`);
    }

    const records = data || [];
    const totalCost = records.reduce(
      (sum, r) => sum + Number(r.cost_usd || 0),
      0
    );
    const totalTokens = records.reduce(
      (sum, r) => sum + Number(r.total_tokens || 0),
      0
    );
    const successfulCalls = records.filter((r) => r.success).length;
    const failedCalls = records.length - successfulCalls;

    // Operation breakdown
    const operationBreakdown: Record<
      string,
      { cost: number; count: number; avgCost: number }
    > = {};
    records.forEach((r) => {
      const opType = r.operation_type || "unknown";
      const cost = Number(r.cost_usd || 0);
      if (!operationBreakdown[opType]) {
        operationBreakdown[opType] = { cost: 0, count: 0, avgCost: 0 };
      }
      operationBreakdown[opType].cost += cost;
      operationBreakdown[opType].count += 1;
    });
    Object.keys(operationBreakdown).forEach((key) => {
      operationBreakdown[key].avgCost =
        operationBreakdown[key].cost / operationBreakdown[key].count;
    });

    // Model breakdown
    const modelBreakdown: Record<
      string,
      { cost: number; count: number; avgCost: number }
    > = {};
    records.forEach((r) => {
      const model = r.model || "unknown";
      const cost = Number(r.cost_usd || 0);
      if (!modelBreakdown[model]) {
        modelBreakdown[model] = { cost: 0, count: 0, avgCost: 0 };
      }
      modelBreakdown[model].cost += cost;
      modelBreakdown[model].count += 1;
    });
    Object.keys(modelBreakdown).forEach((key) => {
      modelBreakdown[key].avgCost =
        modelBreakdown[key].cost / modelBreakdown[key].count;
    });

    // API type breakdown
    const apiTypeBreakdown: Record<
      string,
      { cost: number; count: number; avgCost: number }
    > = {};
    records.forEach((r) => {
      const apiType = r.api_type || "unknown";
      const cost = Number(r.cost_usd || 0);
      if (!apiTypeBreakdown[apiType]) {
        apiTypeBreakdown[apiType] = { cost: 0, count: 0, avgCost: 0 };
      }
      apiTypeBreakdown[apiType].cost += cost;
      apiTypeBreakdown[apiType].count += 1;
    });
    Object.keys(apiTypeBreakdown).forEach((key) => {
      apiTypeBreakdown[key].avgCost =
        apiTypeBreakdown[key].cost / apiTypeBreakdown[key].count;
    });

    // Daily breakdown
    const dailyMap: Record<
      string,
      { cost: number; calls: number; tokens: number }
    > = {};
    records.forEach((r) => {
      const date = new Date(r.created_at).toISOString().split("T")[0];
      if (!dailyMap[date]) {
        dailyMap[date] = { cost: 0, calls: 0, tokens: 0 };
      }
      dailyMap[date].cost += Number(r.cost_usd || 0);
      dailyMap[date].calls += 1;
      dailyMap[date].tokens += Number(r.total_tokens || 0);
    });
    const dailyBreakdown = Object.entries(dailyMap)
      .map(([date, stats]) => ({ date, ...stats }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      summary: {
        totalCost,
        totalTokens,
        totalCalls: records.length,
        successfulCalls,
        failedCalls,
        averageCostPerCall:
          records.length > 0 ? totalCost / records.length : 0,
        averageTokensPerCall:
          records.length > 0 ? totalTokens / records.length : 0,
      },
      operationBreakdown,
      modelBreakdown,
      apiTypeBreakdown,
      dailyBreakdown,
    };
  }
}

