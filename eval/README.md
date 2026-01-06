# Suchi Bot Evaluation Framework

Comprehensive evaluation framework for testing Suchi Cancer Bot responses across 20 cancer types and 5 interaction modes (100 test cases total).

## Features

- **100 Test Cases**: 20 cancers × 5 interaction modes
- **Deterministic Checks**: Regex patterns, question counting, section detection
- **LLM Judge**: Supports both Vertex AI/Gemini and OpenAI for semantic evaluation
- **Comprehensive Reports**: JSON and text report formats with detailed statistics
- **Flexible Configuration**: Environment variables and config file support

## Installation

```bash
cd eval
npm install
```

For Vertex AI support (optional):
```bash
npm install @google-cloud/vertexai
```

## Configuration

### Secure Setup with Google Cloud Secret Manager (Recommended)

**Windows (PowerShell):**
```powershell
cd eval
.\setup-deepseek.ps1
```

This script will:
- Store your API key securely in Google Cloud Secret Manager
- Set up proper IAM permissions
- Configure your project ID

**Manual Setup:**
See [docs/SECRETS_SETUP.md](docs/SECRETS_SETUP.md) for detailed instructions.

**Quick Setup (Environment Variables - Less Secure):**
```bash
export EVAL_LLM_PROVIDER=deepseek
export DEEPSEEK_API_KEY=your_api_key_here
export DEEPSEEK_MODEL=deepseek-chat
```

### Environment Variables

- `EVAL_API_BASE_URL`: API base URL (default: `http://localhost:3001`)
- `EVAL_LLM_PROVIDER`: `openai`, `deepseek`, or `vertex_ai` (default: `openai`)
- `OPENAI_API_KEY`: Required if using OpenAI
- `OPENAI_MODEL`: OpenAI model (default: `gpt-4o`)
- `DEEPSEEK_API_KEY`: Required if using Deepseek
- `DEEPSEEK_MODEL`: Deepseek model (default: `deepseek-chat`)
- `DEEPSEEK_BASE_URL`: Deepseek API base URL (default: `https://api.deepseek.com/v1`)
- `GOOGLE_CLOUD_PROJECT`: Required if using Vertex AI
- `VERTEX_AI_LOCATION`: Vertex AI location (default: `us-central1`)
- `VERTEX_AI_MODEL`: Vertex AI model (default: `gemini-1.5-pro`)
- `EVAL_TIMEOUT_MS`: Request timeout (default: `30000`)
- `EVAL_RETRIES`: Number of retries (default: `2`)
- `EVAL_PARALLEL`: Enable parallel execution (default: `false`)
- `EVAL_MAX_CONCURRENCY`: Max concurrent tests (default: `5`)

### Config File

Edit `config/default.json` or provide a custom config file with `--config`.

**Note:** For security, API keys should be set via environment variables, not in config files that might be committed to git.

## Usage

### Run All Tests

```bash
npm run eval run
```

### Run Specific Test Case

```bash
npm run eval run -- --case SUCHI-T1-BREAST-GEN-01
```

### Run Tests by Tier

```bash
npm run eval run -- --tier 1
```

### Filter by Cancer Type

```bash
npm run eval run -- --cancer breast
```

### Filter by Intent

```bash
npm run eval run -- --intent INFORMATIONAL_GENERAL
```

### Generate Report from Results

```bash
npm run eval report -- --input report.json --format text
```

### Options

- `--cases <path>`: Path to test cases YAML (default: `cases/tier1/common_cancers_20_mode_matrix.yaml`)
- `--rubrics <path>`: Path to rubrics JSON (default: `rubrics/rubrics.v1.json`)
- `--config <path>`: Path to config file
- `--output <path>`: Output path for report JSON (default: `report.json`)
- `--summary`: Print summary to console

## Test Case Structure

Test cases are defined in YAML format with:
- `id`: Unique test case identifier
- `tier`: Test tier (1, 2, 3, etc.)
- `cancer`: Cancer type
- `intent`: Interaction mode (INFORMATIONAL_GENERAL, SYMPTOMATIC_PATIENT, etc.)
- `user_messages`: Array of user messages (multi-turn conversations)
- `expectations`: Expected response characteristics

## Rubric Structure

Rubrics define evaluation criteria:
- **Deterministic Checks**: Fast, rule-based checks (regex, counts)
- **LLM Judge**: Semantic evaluation using LLM
- **Weights**: Importance of each check
- **Pass Threshold**: Minimum score to pass

## Report Format

Reports include:
- Summary statistics (total, passed, failed, average score)
- Individual test results with scores
- Failed test details with error messages
- Evidence quotes from LLM judge

## Example Output

```
SUMMARY
------------------------------------------------------------
Total Tests: 100
Passed: 85 (85.0%)
Failed: 15 (15.0%)
Skipped: 0
Average Score: 87.5%
Total Execution Time: 1250.50s
```

## Troubleshooting

### API Connection Errors

Ensure the Suchi API is running and accessible at the configured `apiBaseUrl`.

### LLM Provider Errors

- **OpenAI**: Ensure `OPENAI_API_KEY` is set
- **Deepseek**: Ensure `DEEPSEEK_API_KEY` is set
- **Vertex AI**: Ensure `GOOGLE_CLOUD_PROJECT` is set and Vertex AI SDK is installed

### Test Case Loading Errors

Verify YAML file format and paths are correct.

## Development

### Build

```bash
npm run build
```

### Run with TypeScript

```bash
npm run eval
```

## License

MIT

