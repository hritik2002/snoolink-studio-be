# Logging System Setup

This document describes the logging system implementation for the Snoolink Studio backend.

## Overview

The logging system captures:
- **User query**: The original search query from the user
- **Enhanced query**: The query after LLM expansion/enhancement
- **Response**: The search results returned to the user
- **Errors**: Any errors that occurred during processing
- **Metadata**: Endpoint, HTTP method, response time, user ID, timestamp

## Performance

The logging system is designed to be **non-blocking** and **highly performant**:
- Uses **fire-and-forget** pattern - logs are written asynchronously without blocking the API response
- Logging failures are silently handled to prevent breaking the API
- All logging operations happen after the response is sent to the user

## Database Setup

### 1. Create the `api_logs` table in Supabase

Run the SQL script in `LOGS_TABLE_SETUP.sql` in your Supabase SQL Editor:

```sql
-- See LOGS_TABLE_SETUP.sql for the complete SQL
```

Or manually create the table with the following structure:

- `id` (UUID, Primary Key)
- `user_id` (UUID, NOT NULL)
- `user_query` (TEXT, NOT NULL)
- `enhanced_query` (TEXT, nullable)
- `response` (JSONB, nullable)
- `error` (TEXT, nullable)
- `endpoint` (TEXT, NOT NULL)
- `method` (TEXT, NOT NULL)
- `response_time_ms` (INTEGER, nullable)
- `created_at` (TIMESTAMPTZ, default: NOW())

### 2. Indexes

The following indexes are created for optimal query performance:
- `idx_api_logs_user_id` - For filtering by user
- `idx_api_logs_created_at` - For date range queries
- `idx_api_logs_endpoint` - For filtering by endpoint

## API Endpoints

### Get Logs

**GET** `/api/logs`

Retrieve logs with optional filtering.

**Query Parameters:**
- `limit` (optional, default: 100) - Number of logs to return
- `offset` (optional, default: 0) - Pagination offset
- `startDate` (optional) - Filter logs from this date (ISO 8601 format)
- `endDate` (optional) - Filter logs until this date (ISO 8601 format)

**Example:**
```bash
GET /api/logs?limit=50&offset=0&startDate=2024-01-01T00:00:00Z
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "user_id": "uuid",
      "user_query": "red car",
      "enhanced_query": "red car vehicle automobile",
      "response": [...],
      "error": null,
      "endpoint": "/api/media/search-images",
      "method": "GET",
      "response_time_ms": 1234,
      "created_at": "2024-01-01T12:00:00Z"
    }
  ],
  "pagination": {
    "total": 1000,
    "limit": 50,
    "offset": 0
  }
}
```

### Get Log Statistics

**GET** `/api/logs/stats`

Get aggregated statistics about logs.

**Response:**
```json
{
  "success": true,
  "data": {
    "total": 1000,
    "errors": 5,
    "avgResponseTime": 1234.56
  }
}
```

## Authentication

All log endpoints require authentication. Users can only see their own logs (filtered by `user_id`).

## Integration

Logging is automatically integrated into the `searchImages` endpoint. Every search request is logged with:
- The original user query
- The enhanced/expanded query
- The search results
- Any errors that occurred
- Response time in milliseconds

## Future Enhancements

Potential improvements:
- Add log retention policies (auto-delete old logs)
- Add more detailed error tracking
- Add request/response size tracking
- Add rate limiting metrics
- Add export functionality (CSV, JSON)

