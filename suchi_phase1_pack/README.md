# Suchi Phase 1 Pack

Suchi (Suchitra Cancer Bot) - A cancer information assistant with safety guardrails, KB-backed responses, and feedback collection.

## Contents
- `apps/api` - NestJS + Prisma backend with Google Gemini LLM integration
- `apps/web` - React + Vite frontend chat UI
- `kb` - Knowledge base files and manifest
- `docs` - PRD, technical spec, and KB structure documentation

## Prerequisites
- Node.js 18+ and npm
- PostgreSQL database
- Google Gemini API key ([Get one here](https://makersuite.google.com/app/apikey))

## Backend Setup

1. Navigate to the API directory:
   ```bash
   cd apps/api
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create `.env` file with the following variables:
   ```env
   DATABASE_URL=postgresql://user:password@localhost:5432/suchi_db
   ADMIN_BASIC_USER=admin
   ADMIN_BASIC_PASS=your_secure_password
   GEMINI_API_KEY=your_gemini_api_key_here
   PORT=3001
   NODE_ENV=development
   RATE_LIMIT_TTL_SEC=60
   RATE_LIMIT_REQ_PER_TTL=20
   ```

4. Generate Prisma client:
   ```bash
   npx prisma generate
   ```

5. Run database migrations:
   ```bash
   npx prisma migrate dev --name init
   ```

6. (Optional) Ingest knowledge base:
   ```bash
   npm run kb:dry     # Dry run to verify KB structure
   npm run kb:ingest  # Ingest KB into database
   ```

7. Start the development server:
   ```bash
   npm run dev
   ```

The API will be available at `http://localhost:3001/v1`

## Frontend Setup

1. Navigate to the web directory:
   ```bash
   cd apps/web
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. (Optional) Create `.env` file to configure API URL:
   ```env
   VITE_API_URL=http://localhost:3001/v1
   ```
   If not set, it defaults to `/v1` (using Vite proxy).

4. Start the development server:
   ```bash
   npm run dev
   ```

The web UI will be available at `http://localhost:3000`

## API Endpoints

### Public Endpoints
- `POST /v1/sessions` - Create a new chat session
- `POST /v1/chat` - Send a message and get response
- `POST /v1/feedback` - Submit feedback for a message
- `GET /v1/health` - Health check endpoint

### Admin Endpoints (Basic Auth)
- `GET /v1/admin/conversations` - List conversations with optional filters
- `GET /v1/admin/metrics` - Get analytics metrics

## Features

### Safety Features
- Emergency detection and warning banners
- Self-harm detection with crisis support guidance
- Refusal to diagnose or prescribe medications
- Misinformation detection (e.g., stopping treatment)

### Chat Features
- KB-backed responses using Vector RAG (pgvector semantic search)
- Google Gemini Pro for response generation
- Suggested prompts for new users
- Feedback collection (thumbs up/down)
- Session management
- "Start over" functionality

### Knowledge Base Features
- Vector embeddings for semantic search (pgvector)
- Keyword search fallback for backward compatibility
- YouTube transcript extraction from Suchitra Cancer Care Foundation channel
- Monthly automated KB updates
- Gold Stack organization with source traceability

### Admin Features
- View conversations with filtering options
- Analytics and metrics dashboard
- Protected with Basic Authentication

## Deployment

For Railway deployment (recommended):
1. Connect your GitHub repository to Railway
2. Set environment variables in Railway dashboard
3. Deploy both `apps/api` and `apps/web` as separate services
4. Configure database connection string
5. Run migrations: `npx prisma migrate deploy`

## Knowledge Base Setup

### Vector RAG Setup
1. Ensure PostgreSQL has pgvector extension installed
2. Run migrations: `npx prisma migrate dev`
3. See [`docs/VECTOR_RAG_SETUP.md`](docs/VECTOR_RAG_SETUP.md) for detailed instructions

### YouTube Transcript Extraction
1. Install Python dependencies: `cd scripts/youtube-transcripts && pip install -r requirements.txt`
2. Extract transcripts: `python extract_transcripts.py --video-ids VIDEO_ID1 VIDEO_ID2`
3. See [`scripts/youtube-transcripts/README.md`](scripts/youtube-transcripts/README.md) for details

### NCI Data Ingestion
1. Install Python dependencies: `cd scripts/nci-ingestion && pip install -r requirements.txt`
2. Run full pipeline: `python update_nci.py`
3. Process NCIt thesaurus: `python process_ncit.py --force-download`
4. See [`docs/NCI_INGESTION_GUIDE.md`](docs/NCI_INGESTION_GUIDE.md) for detailed instructions

### Monthly Updates

**YouTube Transcripts**:
```bash
cd scripts/youtube-transcripts
bash update_monthly.sh
```

**NCI Content**:
```bash
cd scripts/nci-ingestion
bash update_nci.sh
```

## Sanity Check

A sanity check script verifies that all components are working correctly. It runs automatically when you open the workspace in Cursor, and can also be run manually.

### Automatic Check

The sanity check runs automatically when you open the workspace (configured in `.cursor/tasks.json`). It will:
- ✅ Check frontend build
- ✅ Check backend health endpoint
- ✅ Test RAG retrieval with a sample query
- ✅ Test AI model response generation

### Manual Check

Run the sanity check manually:

```bash
# Full check (includes build and functional tests)
npm run sanity-check

# Quick check (skips build and functional tests, faster)
npm run sanity-check:quick
```

### What It Checks

1. **Frontend**: Verifies the web app can build successfully
2. **Backend**: Checks health endpoint and database connectivity
3. **RAG**: Tests retrieval with a sample query, verifies trusted sources in top-3
4. **AI Model**: Tests LLM response generation, verifies citations are present

### Requirements

- Root dependencies installed: `npm install` (from repo root)
- Backend running (for RAG and AI model checks): Start with `cd apps/api && npm run dev`
- Environment variables configured (API keys, database URL, etc.)

### Output

The script provides clear pass/fail indicators:
- ✅ Success: Component is working
- ❌ Failure: Component has issues (see details)
- ⏭️ Skipped: Component check was skipped (e.g., backend not running)

## Development Notes

- Backend runs on port 3001 by default
- Frontend runs on port 3000 with proxy to backend
- Health check endpoint available at `/v1/health`
- All API endpoints are prefixed with `/v1`
- Frontend uses sessionStorage to persist consent state
- Vector embeddings require `EMBEDDING_API_KEY` (can use `GEMINI_API_KEY`)
