#### Update Video
```http
PUT /api/videos/{videoId}
Content-Type: application/json

{
  "name": "Updated video name"
}
```

#### Generate Video Summary
```http
POST /api/videos/{videoId}/summarize
Content-Type: application/json

{
  "type": "summary"
}
```

#### Generate Video Transcription
```http
POST /api/videos/{videoId}/text
```#### Get Specific Index
```http
GET /api/indexes/{indexId}
```

#### Get All Tasks
```http
GET /api/tasks?indexId={indexId}&status={status}
```# Twelve Labs Video Service Backend

A Node.js backend service for uploading videos to Twelve Labs, creating embeddings, and performing vector-based video search.

## Features

- Upload videos to Twelve Labs and create embeddings
- Vector-based video search functionality
- Index management for organizing videos
- Task status monitoring
- Video metadata storage and retrieval
- RESTful API endpoints

## Prerequisites

- Node.js 16 or higher
- Twelve Labs API key (get it from [Twelve Labs Console](https://console.twelvelabs.io/))

## Installation

1. Clone or create the project:
```bash
mkdir twelvelabs-video-service
cd twelvelabs-video-service
```

2. Install dependencies:
```bash
npm install
```

3. Create environment file:
```bash
cp .env.example .env
```

4. Add your Twelve Labs API key to `.env`:
```
TWELVE_LABS_API_KEY=your_actual_api_key_here
```

## Key Features

- **Official SDK Integration**: Uses the official `twelvelabs-js` SDK for reliable API communication
- **Advanced Search**: Support for multiple search types with configurable thresholds
- **Video Generation**: Built-in summarization and transcription capabilities
- **Task Management**: Complete task lifecycle management with status tracking
- **Enhanced Metadata**: Combines Twelve Labs data with custom metadata storage

## Usage

1. Start the server:
```bash
npm start
# or for development with auto-reload:
npm run dev
```

2. The server will run on `http://localhost:3000`

## API Endpoints

### Index Management

#### Create Index
```http
POST /api/indexes
Content-Type: application/json

{
  "name": "my-video-index",
  "engines": ["marengo2.6"]
}
```

#### Get All Indexes
```http
GET /api/indexes
```

### Video Upload

#### Upload Video
```http
POST /api/upload
Content-Type: multipart/form-data

Form Data:
- video: [video file]
- indexId: [index ID from created index]
- language: "en" (optional, default: "en")
```

#### Check Upload Status
```http
GET /api/tasks/{taskId}
```

### Video Search

#### Search Videos
```http
POST /api/search
Content-Type: application/json

{
  "indexId": "your-index-id",
  "query": "people walking in the park",
  "searchOptions": ["visual", "conversation", "text_in_video"],
  "threshold": "medium",
  "maxResults": 10
}
```

#### Advanced Search
```http
POST /api/search/advanced
Content-Type: application/json

{
  "indexId": "your-index-id",
  "query": "people walking in the park",
  "options": ["visual", "conversation"],
  "threshold": "high",
  "maxResults": 20,
  "sortOption": "score",
  "sortBy": "score",
  "pageToken": "optional-pagination-token"
}
```

### Video Management

#### Get Videos from Index
```http
GET /api/videos?indexId={indexId}
```

#### Get Video Details
```http
GET /api/videos/{videoId}
```

#### Get All Videos
```http
GET /api/videos
```

#### Delete Video
```http
DELETE /api/videos/{videoId}
```

### Health Check
```http
GET /health
```

## Example Usage Flow

1. **Create an Index:**
```bash
curl -X POST http://localhost:3000/api/indexes \
  -H "Content-Type: application/json" \
  -d '{"name": "my-videos", "engines": ["marengo2.6"]}'
```

2. **Upload a Video:**
```bash
curl -X POST http://localhost:3000/api/upload \
  -F "video=@/path/to/your/video.mp4" \
  -F "indexId=your-index-id" \
  -F "language=en"
```

3. **Check Upload Status:**
```bash
curl http://localhost:3000/api/tasks/your-task-id
```

4. **Search Videos:**
```bash
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d '{
    "indexId": "your-index-id",
    "query": "person walking",
    "searchOptions": ["visual"],
    "maxResults": 5
  }'
```

## Response Format

All API responses follow this format:

```json
{
  "success": true|false,
  "data": {...},
  "error": "error message if success is false"
}
```

## Search Options

The search endpoint supports different types of searches:

- `visual`: Search based on visual content
- `conversation`: Search based on spoken content
- `text_in_video`: Search based on text appearing in video
- `logo`: Search for logos and brands

## Thresholds

Search threshold options:
- `low`: More results, less precise
- `medium`: Balanced results (default)
- `high`: Fewer results, more precise

## File Upload Limits

- Maximum file size: 500MB
- Supported formats: MP4, MOV, AVI, and other common video formats

## Error Handling

The service includes comprehensive error handling:
- File upload errors
- API communication errors
- Invalid request validation
- Server errors

## Production Considerations

For production deployment, consider:

1. **Database**: Replace the in-memory storage with a proper database (PostgreSQL, MongoDB, etc.)
2. **File Storage**: Use cloud storage (AWS S3, Google Cloud Storage) instead of local storage
3. **Rate Limiting**: Implement rate limiting for API endpoints
4. **Authentication**: Add authentication and authorization
5. **Logging**: Implement proper logging with tools like Winston
6. **Environment**: Use process managers like PM2
7. **Security**: Add security middleware (helmet, cors, etc.)

## Environment Variables

- `TWELVE_LABS_API_KEY`: Your Twelve Labs API key (required)
- `PORT`: Server port (default: 3000)

## License

MIT License



APP flow:
Video upload
video is sent to LLM (genai)
LLM returns an array of items, each item describes some timeframe (suppose 5 sec)
[5 sec summary, 5sec summary, ...so on]
We then pass every summary to twelvelabs and get coherent video from creators source
We then stitch the frames to create a new original video based on the viral theme