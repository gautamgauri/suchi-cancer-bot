#!/bin/bash
# Monthly YouTube Transcript Update Script for Suchi KB

set -e  # Exit on error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
API_DIR="$PROJECT_ROOT/apps/api"
KB_DIR="$PROJECT_ROOT/kb"

echo "=========================================="
echo "Suchi KB: Monthly YouTube Transcript Update"
echo "=========================================="
echo ""

# Check if Python is available
if ! command -v python3 &> /dev/null; then
    echo "Error: python3 not found. Please install Python 3."
    exit 1
fi

# Check if virtual environment exists, create if not
VENV_DIR="$SCRIPT_DIR/venv"
if [ ! -d "$VENV_DIR" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv "$VENV_DIR"
fi

# Activate virtual environment
source "$VENV_DIR/bin/activate"

# Install/update dependencies
echo "Installing Python dependencies..."
pip install -q -r "$SCRIPT_DIR/requirements.txt"

# Extract transcripts
echo ""
echo "Step 1: Extracting YouTube transcripts..."
cd "$SCRIPT_DIR"
python3 extract_transcripts.py --channel-id UCI242a2_VRTCdCbpXzyeW4w

# Check if new files were created
NEW_FILES=$(find "$KB_DIR/en/01_suchi_oncotalks" -name "oncotalks-*.md" -mtime -1 2>/dev/null | wc -l || echo "0")

if [ "$NEW_FILES" -eq "0" ]; then
    echo "No new transcripts found. Exiting."
    exit 0
fi

echo ""
echo "Step 2: New transcripts found. Ingesting into KB..."
cd "$API_DIR"

# Check if Node.js dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "Installing Node.js dependencies..."
    npm install
fi

# Run KB ingestion with embeddings
echo "Running KB ingestion with embeddings..."
npm run kb:ingest

echo ""
echo "=========================================="
echo "✓ Monthly update completed successfully!"
echo "=========================================="
echo ""
echo "Summary:"
echo "  - New transcripts: $NEW_FILES"
echo "  - KB ingestion: Completed"
echo "  - Embeddings: Generated"
echo ""
echo "Next steps:"
echo "  1. Review ingested content in admin panel"
echo "  2. Test queries to verify new content"
echo ""






















