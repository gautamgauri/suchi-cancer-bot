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

# Check if new drafts were created (either language folder)
NEW_FILES=$(find "$KB_DIR/hi/01_suchi_oncotalks" "$KB_DIR/en/01_suchi_oncotalks" \
    -name "oncotalks-*.md" -mtime -1 2>/dev/null | wc -l || echo "0")

echo ""
echo "=========================================="
echo "✓ Transcript drafts regenerated"
echo "=========================================="
echo ""
echo "Summary:"
echo "  - New/updated transcript drafts: $NEW_FILES"
echo "  - Staged manifest: $KB_DIR/manifest.oncotalks-pending.json"
echo ""
echo "This script deliberately STOPS here. It used to run 'npm run kb:ingest'"
echo "straight afterwards, which would have chunked and embedded uncorrected"
echo "machine captions of medical conversation with no human in the loop."
echo "See issue #91: every caption on this channel is machine-generated and is"
echo "demonstrably wrong on names, drug names and numbers."
echo ""
echo "Next steps:"
echo "  1. Open a PR with the new drafts under kb/hi/01_suchi_oncotalks/."
echo "  2. Have SCCF correct the captions and record the review."
echo "  3. Only then move the entry from manifest.oncotalks-pending.json into"
echo "     kb/manifest.json, set status to \"active\", and run npm run kb:ingest."
echo ""
