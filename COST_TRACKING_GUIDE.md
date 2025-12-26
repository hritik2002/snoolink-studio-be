# Cost Tracking System Guide

## Overview

The cost tracking system automatically tracks all OpenAI API usage and costs across the application. This provides comprehensive business intelligence for making data-driven decisions about pricing, usage patterns, and cost optimization.

## Features

### ✅ Comprehensive Tracking
- **All API Types**: Tracks chat completions, embeddings, and vision API calls
- **Token Usage**: Captures prompt tokens, completion tokens, and total tokens
- **Cost Calculation**: Automatically calculates costs based on current OpenAI pricing
- **Metadata**: Stores rich context (user, endpoint, operation type, collection, etc.)

### ✅ Business Intelligence
- **User-level Analytics**: Track costs per user
- **Operation Breakdown**: See costs by operation type (image description, query expansion, etc.)
- **Model Analysis**: Understand which models are most cost-effective
- **Time-based Trends**: Analyze costs over time

### ✅ Data Captured

For every OpenAI API call, we track:

1. **Basic Info**
   - User ID
   - Timestamp
   - API Type (chat_completion, embedding, vision)
   - Model used
   - Operation Type (image_description, query_expansion, video_frame_description, etc.)

2. **Token Usage**
   - Prompt tokens
   - Completion tokens
   - Total tokens

3. **Cost Information**
   - Total cost in USD (high precision: 8 decimal places)
   - Cost breakdown (input_cost, output_cost, etc.)

4. **Context & Metadata**
   - Endpoint/route where called
   - Additional context
   - Flexible JSON metadata (collection_name, resource_type, video_url, etc.)

5. **Performance**
   - Response time in milliseconds
   - Success/failure status
   - Error messages (if failed)
   - OpenAI request ID

## Database Schema

The `openai_cost_tracking` table stores all cost data with the following structure:

```sql
- id: BIGSERIAL PRIMARY KEY
- user_id: UUID (indexed)
- api_type: TEXT ('chat_completion', 'embedding', 'vision')
- model: TEXT (indexed)
- operation_type: TEXT (indexed)
- prompt_tokens: INTEGER
- completion_tokens: INTEGER
- total_tokens: INTEGER
- cost_usd: DECIMAL(12, 8)
- cost_breakdown: JSONB
- endpoint: TEXT
- context: TEXT
- metadata: JSONB
- request_id: TEXT
- response_time_ms: INTEGER
- success: BOOLEAN
- error_message: TEXT
- created_at: TIMESTAMPTZ (indexed)
```

## Setup

1. **Run the SQL migration**:
   ```bash
   # Execute the SQL script in your Supabase SQL editor
   src/scripts/COST_TRACKING_TABLE_SETUP.sql
   ```

2. **The system is automatically integrated** - no additional configuration needed!

## Pricing Models

Current pricing (as of 2024) is configured in `costTracking.service.ts`:

### Chat Completions
- **gpt-4o-mini**: $0.15/$0.60 per 1M tokens (input/output)
- **gpt-4o**: $2.50/$10.00 per 1M tokens (input/output)
- **gpt-4-turbo**: $10.00/$30.00 per 1M tokens (input/output)

### Embeddings
- **text-embedding-ada-002**: $0.10 per 1M tokens
- **text-embedding-3-small**: $0.02 per 1M tokens
- **text-embedding-3-large**: $0.13 per 1M tokens

*Note: Update pricing in `costTracking.service.ts` if OpenAI changes their rates.*

## API Endpoints

### 1. Export Cost Data (JSON)

**GET** `/api/cost/export`

Export cost data in JSON format with comprehensive filtering options.

**Query Parameters:**
- `startDate` (optional): ISO date string - Filter records from this date
- `endDate` (optional): ISO date string - Filter records until this date
- `operationType` (optional): Filter by operation type (e.g., "image_description", "query_expansion")
- `model` (optional): Filter by model (e.g., "gpt-4o-mini", "text-embedding-ada-002")
- `apiType` (optional): Filter by API type ("chat_completion", "embedding", "vision")
- `includeFailed` (optional): Boolean - Include failed API calls (default: false)
- `limit` (optional): Number - Max records to return (default: 1000, max: 10000)
- `offset` (optional): Number - Pagination offset (default: 0)
- `format` (optional): "detailed" or "summary" (default: "detailed")

**Example Request:**
```bash
# Export all cost data for last 30 days
GET /api/cost/export?startDate=2024-01-01T00:00:00Z&endDate=2024-01-31T23:59:59Z

# Export only image description costs
GET /api/cost/export?operationType=image_description&limit=500

# Export summary statistics
GET /api/cost/export?format=summary&startDate=2024-01-01T00:00:00Z
```

**Example Response (Detailed):**
```json
{
  "success": true,
  "format": "detailed",
  "filters": {
    "startDate": "2024-01-01T00:00:00.000Z",
    "endDate": "2024-01-31T23:59:59.999Z",
    "includeFailed": false
  },
  "pagination": {
    "limit": 1000,
    "offset": 0,
    "total": 2500,
    "hasMore": true
  },
  "data": [
    {
      "id": 123,
      "timestamp": "2024-01-15T10:30:00.000Z",
      "apiType": "vision",
      "model": "gpt-4o-mini",
      "operationType": "image_description",
      "tokens": {
        "prompt": 150,
        "completion": 50,
        "total": 200
      },
      "cost": {
        "usd": 0.000045,
        "breakdown": {
          "input_cost_usd": 0.0000225,
          "output_cost_usd": 0.00003,
          "total_cost_usd": 0.000045
        }
      },
      "endpoint": "image_processing_worker",
      "context": "Image description for semantic search",
      "metadata": {
        "collection_name": "Default",
        "resource_type": "image",
        "image_url": "https://..."
      },
      "performance": {
        "responseTimeMs": 1250,
        "success": true,
        "errorMessage": null
      },
      "requestId": "req_abc123"
    }
  ],
  "exportedAt": "2024-01-31T12:00:00.000Z"
}
```

**Example Response (Summary):**
```json
{
  "success": true,
  "format": "summary",
  "filters": {
    "startDate": "2024-01-01T00:00:00.000Z",
    "endDate": "2024-01-31T23:59:59.999Z"
  },
  "data": {
    "summary": {
      "totalCost": 12.45,
      "totalTokens": 125000,
      "totalCalls": 500,
      "successfulCalls": 495,
      "failedCalls": 5,
      "averageCostPerCall": 0.0249,
      "averageTokensPerCall": 250
    },
    "operationBreakdown": {
      "image_description": {
        "cost": 5.20,
        "count": 200,
        "avgCost": 0.026
      },
      "query_expansion": {
        "cost": 2.15,
        "count": 150,
        "avgCost": 0.0143
      }
    },
    "modelBreakdown": {
      "gpt-4o-mini": {
        "cost": 7.35,
        "count": 350,
        "avgCost": 0.021
      },
      "text-embedding-ada-002": {
        "cost": 5.10,
        "count": 145,
        "avgCost": 0.0352
      }
    },
    "apiTypeBreakdown": {
      "vision": {
        "cost": 5.20,
        "count": 200,
        "avgCost": 0.026
      },
      "chat_completion": {
        "cost": 2.15,
        "count": 150,
        "avgCost": 0.0143
      },
      "embedding": {
        "cost": 5.10,
        "count": 145,
        "avgCost": 0.0352
      }
    },
    "dailyBreakdown": [
      {
        "date": "2024-01-01",
        "cost": 0.45,
        "calls": 20,
        "tokens": 5000
      },
      {
        "date": "2024-01-02",
        "cost": 0.52,
        "calls": 25,
        "tokens": 6000
      }
    ]
  },
  "exportedAt": "2024-01-31T12:00:00.000Z"
}
```

### 2. Get Cost Summary

**GET** `/api/cost/summary`

Get a quick cost summary for the authenticated user.

**Query Parameters:**
- `startDate` (optional): ISO date string
- `endDate` (optional): ISO date string

**Example Request:**
```bash
GET /api/cost/summary?startDate=2024-01-01T00:00:00Z&endDate=2024-01-31T23:59:59Z
```

**Example Response:**
```json
{
  "success": true,
  "filters": {
    "startDate": "2024-01-01T00:00:00.000Z",
    "endDate": "2024-01-31T23:59:59.999Z"
  },
  "data": {
    "totalCost": 12.45,
    "totalTokens": 125000,
    "operationBreakdown": {
      "image_description": { "cost": 5.20, "count": 200 },
      "query_expansion": { "cost": 2.15, "count": 150 }
    },
    "modelBreakdown": {
      "gpt-4o-mini": { "cost": 7.35, "count": 350 },
      "text-embedding-ada-002": { "cost": 5.10, "count": 145 }
    }
  }
}
```

### 3. Get Detailed Statistics

**GET** `/api/cost/statistics`

Get comprehensive cost statistics with detailed breakdowns.

**Query Parameters:**
- `startDate` (optional): ISO date string
- `endDate` (optional): ISO date string

**Example Request:**
```bash
GET /api/cost/statistics?startDate=2024-01-01T00:00:00Z
```

**Example Response:**
```json
{
  "success": true,
  "filters": {
    "startDate": "2024-01-01T00:00:00.000Z"
  },
  "data": {
    "summary": {
      "totalCost": 12.45,
      "totalTokens": 125000,
      "totalCalls": 500,
      "successfulCalls": 495,
      "failedCalls": 5,
      "averageCostPerCall": 0.0249,
      "averageTokensPerCall": 250
    },
    "operationBreakdown": { ... },
    "modelBreakdown": { ... },
    "apiTypeBreakdown": { ... },
    "dailyBreakdown": [ ... ]
  }
}
```

## Frontend API Routes

The frontend also provides proxy routes:

- **GET** `/api/cost/export` - Proxy to backend export endpoint
- **GET** `/api/cost/summary` - Proxy to backend summary endpoint
- **GET** `/api/cost/statistics` - Proxy to backend statistics endpoint

## Usage Examples

### Get User Cost Summary (Backend Service)

```typescript
import { CostTrackingService } from "./services/costTracking.service";

const costTracker = new CostTrackingService();

// Get summary for a user
const summary = await costTracker.getUserCostSummary(
  userId,
  new Date('2024-01-01'), // start date (optional)
  new Date('2024-12-31')   // end date (optional)
);

console.log(summary);
// {
//   totalCost: 0.045,
//   totalTokens: 15000,
//   operationBreakdown: {
//     image_description: { cost: 0.02, count: 10 },
//     query_expansion: { cost: 0.01, count: 50 },
//     ...
//   },
//   modelBreakdown: {
//     'gpt-4o-mini': { cost: 0.03, count: 60 },
//     'text-embedding-ada-002': { cost: 0.015, count: 100 },
//     ...
//   }
// }
```

### Export Cost Data (Frontend)

```typescript
// Export all cost data
const response = await fetch('/api/cost/export');
const data = await response.json();

// Export with filters
const response = await fetch(
  '/api/cost/export?startDate=2024-01-01T00:00:00Z&operationType=image_description&limit=500'
);
const data = await response.json();

// Download as JSON file
const blob = new Blob([JSON.stringify(data.data, null, 2)], { type: 'application/json' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = `cost-export-${new Date().toISOString()}.json`;
a.click();
```

### Query Cost Data Directly

```sql
-- Get total cost per user for last 30 days
SELECT 
  user_id,
  SUM(cost_usd) as total_cost,
  SUM(total_tokens) as total_tokens,
  COUNT(*) as api_calls
FROM openai_cost_tracking
WHERE created_at >= NOW() - INTERVAL '30 days'
  AND success = true
GROUP BY user_id
ORDER BY total_cost DESC;

-- Get cost breakdown by operation type
SELECT 
  operation_type,
  SUM(cost_usd) as total_cost,
  AVG(cost_usd) as avg_cost,
  COUNT(*) as count
FROM openai_cost_tracking
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY operation_type
ORDER BY total_cost DESC;

-- Get most expensive operations
SELECT 
  user_id,
  operation_type,
  endpoint,
  cost_usd,
  total_tokens,
  created_at
FROM openai_cost_tracking
WHERE success = true
ORDER BY cost_usd DESC
LIMIT 100;
```

## Tracked Operations

The system automatically tracks:

1. **Image Description** (`image_description`)
   - When: Images are uploaded and processed
   - API: Vision (gpt-4o-mini)
   - Metadata: collection_name, resource_type, image_url

2. **Query Expansion** (`query_expansion`)
   - When: User searches for images/videos
   - API: Chat Completion (gpt-4o-mini)
   - Metadata: endpoint, query_length

3. **Video Frame Description** (`video_frame_description`)
   - When: Videos are processed (each frame)
   - API: Vision (gpt-4o-mini)
   - Metadata: video_url, chunk_index, collection_name

4. **Video Summary** (`video_summary`)
   - When: Video chunks are summarized
   - API: Chat Completion (gpt-4o-mini)
   - Metadata: video_url, chunk_index, frame_count

5. **Embeddings** (`embedding`)
   - When: Text is embedded for vector search
   - API: Embeddings (text-embedding-ada-002)
   - Metadata: namespace, operation (upsert/query)

## Business Insights

### Cost Analysis Queries

```sql
-- Daily cost trends
SELECT 
  DATE(created_at) as date,
  SUM(cost_usd) as daily_cost,
  COUNT(*) as api_calls
FROM openai_cost_tracking
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- Cost per user (top 10)
SELECT 
  user_id,
  SUM(cost_usd) as total_cost,
  COUNT(DISTINCT DATE(created_at)) as active_days,
  AVG(cost_usd) as avg_cost_per_call
FROM openai_cost_tracking
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY user_id
ORDER BY total_cost DESC
LIMIT 10;

-- Most expensive endpoints
SELECT 
  endpoint,
  operation_type,
  SUM(cost_usd) as total_cost,
  COUNT(*) as calls,
  AVG(response_time_ms) as avg_response_time
FROM openai_cost_tracking
WHERE success = true
GROUP BY endpoint, operation_type
ORDER BY total_cost DESC;
```

## Integration Points

Cost tracking is automatically integrated into:

1. **LLMServices** (`llm.service.ts`)
   - `describeImage()` - Tracks vision API calls
   - `ask()` - Tracks chat completion calls

2. **VectorDBService** (`vectordb.service.ts`)
   - `embed()` - Tracks embedding API calls

3. **VideoProcessingService** (`videoProcessing.service.ts`)
   - `describeFrameWithGPT()` - Tracks video frame descriptions
   - `generateClipSummary()` - Tracks video summaries

4. **ResourceProcessingService** (`resrouceProcessing.service.ts`)
   - `expandQuery()` - Tracks query expansion

## Error Handling

- Cost tracking failures **never break** the main application flow
- Errors are logged but don't throw exceptions
- Failed API calls are still tracked (with `success: false`)

## Future Enhancements

Potential improvements:

1. **Cost Alerts**: Notify when costs exceed thresholds
2. **Budget Limits**: Set per-user or per-organization budgets
3. **Cost Optimization Suggestions**: Identify expensive operations
4. **Real-time Dashboard**: Live cost monitoring
5. **Export Reports**: CSV/PDF cost reports
6. **Cost Forecasting**: Predict future costs based on trends

## Maintenance

### Updating Pricing

When OpenAI updates pricing, update `OPENAI_PRICING` in `costTracking.service.ts`:

```typescript
const OPENAI_PRICING = {
  "gpt-4o-mini": {
    input: 0.15 / 1000,  // Update these values
    output: 0.6 / 1000,
    image: 0.0,
  },
  // ... other models
};
```

### Adding New Models

1. Add model to `OPENAI_PRICING` in `costTracking.service.ts`
2. The system will automatically track costs for the new model

## Security

- Row Level Security (RLS) enabled
- Users can only view their own cost data
- Service role can manage all cost tracking (for backend operations)

## Performance

- All cost tracking operations are **asynchronous** and **non-blocking**
- Database indexes optimized for common queries
- Minimal performance impact on main application flow

