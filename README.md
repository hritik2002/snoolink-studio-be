# Snoolink Studio Backend

Backend service for handling file uploads, image-to-text conversion using Vision Language Models (VLM), and vector database embeddings for semantic search.

## Features

- 📤 **File Upload**: Upload images with Cloudinary integration
- 🖼️ **Image Processing**: Convert images to text descriptions using VLM (Ollama/LLaVA)
- 🔍 **Vector Search**: Generate embeddings and store in vector database for semantic search
- 💾 **Metadata Storage**: Store image metadata in Supabase
- 🏗️ **Clean Architecture**: Modular structure with separation of concerns

## Tech Stack

- **Runtime**: Node.js (ES Modules)
- **Framework**: Express.js
- **Storage**: Cloudinary (media), Supabase (metadata)
- **VLM**: Ollama (LLaVA model)
- **Embeddings**: OpenAI (text-embedding-3-small)
- **Vector DB**: Local VectorDB (@hritik2002/local-vectordb)

## Quick Start

### Prerequisites

- Node.js >= 20.0.0
- Environment variables configured (see `.env.example`)

### Installation

```bash
npm install
```

### Environment Variables

```env
PORT=3000
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key
OPENAI_API_KEY=your_openai_key
```

### Run

```bash
# Development
npm run dev

# Production
npm start
```

## API Endpoints

### Upload Images
```http
POST /api/upload-images
Content-Type: multipart/form-data

Form Data:
- images: [image files]
```

### Get All Images
```http
GET /api/get-all-images
```

### Health Check
```http
GET /api/health
```

## Project Structure

```
src/
├── config/          # Configuration & environment
├── routes/          # API route definitions
├── controllers/     # HTTP request/response handling
├── services/        # Business logic
├── models/          # Data models
└── utils/           # Shared utilities
```

## Future Scope

- 🔐 **Authentication & Authorization**: JWT-based auth with role-based access control
- 📹 **Video Processing**: Extend to support video uploads and processing
- 🔄 **Batch Processing**: Queue system for handling large batch uploads
- 🌐 **Multi-VLM Support**: Support for multiple VLM providers (OpenAI Vision, Google Gemini)
- 🗄️ **Database Migration**: Move from local VectorDB to production-ready solutions (Pinecone, Weaviate)
- 📊 **Analytics**: Track usage, processing times, and search patterns
- 🚀 **Caching Layer**: Redis integration for improved performance
- 🧪 **Testing**: Unit and integration tests
- 📝 **API Documentation**: OpenAPI/Swagger documentation
- 🔔 **Webhooks**: Event notifications for processing completion
- 🌍 **Multi-tenancy**: Support for multiple organizations/users
- ⚡ **Performance**: Image optimization and CDN integration
- 🛡️ **Rate Limiting**: Protect APIs from abuse
- 📦 **Docker Support**: Containerization for easy deployment

## License

MIT
