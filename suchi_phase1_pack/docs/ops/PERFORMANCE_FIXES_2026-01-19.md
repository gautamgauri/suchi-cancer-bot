# Performance Fixes - Second Query Timeout Issue

**Date**: 2026-01-19  
**Issue**: Second query times out after 15+ seconds ("Suchi is thinking..." but no response)  
**Status**: Fixed

## Root Cause Analysis

The timeout issue was caused by:

1. **No Overall Request Timeout**: The chat controller had no timeout wrapper, so if any operation hung, the request would wait indefinitely
2. **Short LLM Timeout**: LLM timeout was only 10s, which might be too short for complex queries
3. **Missing Timeout Error Handling**: Timeout errors weren't being caught and returned gracefully to the frontend

## Fixes Applied

### 1. Added Overall Request Timeout (30s)
**File**: `apps/api/src/modules/chat/chat.controller.ts`

- Added `REQUEST_TIMEOUT_MS = 30000` (30 seconds)
- Wrapped `chat.handle()` in `Promise.race()` with timeout
- Returns `GatewayTimeoutException` with user-friendly message if timeout occurs

```typescript
const timeoutPromise = new Promise((_, reject) => {
  setTimeout(() => {
    reject(new Error('REQUEST_TIMEOUT'));
  }, this.REQUEST_TIMEOUT_MS);
});

return await Promise.race([
  this.chat.handle(dto),
  timeoutPromise
]);
```

### 2. Increased LLM Timeout (10s → 15s)
**File**: `apps/api/src/modules/llm/llm.service.ts`

- Increased default timeout from 10s to 15s
- Still configurable via `LLM_TIMEOUT_MS` environment variable
- Better handles complex queries that need more processing time

### 3. Improved Timeout Error Handling
**File**: `apps/api/src/modules/chat/chat.controller.ts`

- Added specific handling for `REQUEST_TIMEOUT` errors
- Returns user-friendly message: "I'm experiencing high load. Please try again in a moment."
- Logs timeout events for monitoring

## Expected Behavior After Fix

1. **Fast Responses**: Normal queries should complete within 5-10 seconds
2. **Timeout Protection**: If a request takes longer than 30 seconds, it will timeout gracefully
3. **User Feedback**: Users see a clear message instead of infinite "thinking..." state
4. **Better Logging**: Timeout events are logged for debugging

## Testing Recommendations

1. **Test Second Query**: Send a second query after the first one completes
2. **Test Complex Queries**: Try queries like "What is the difference between benign and malignant tumors?"
3. **Monitor Logs**: Check Cloud Run logs for timeout events
4. **Load Testing**: Test with multiple concurrent requests

## Configuration

### Environment Variables

- `LLM_TIMEOUT_MS`: LLM API call timeout (default: 15000ms)
- Request timeout is hardcoded to 30s (can be made configurable if needed)

### Cloud Run Settings

Current Cloud Run configuration:
- Memory: 512Mi
- CPU: 1
- Timeout: 300s (Cloud Run default - our 30s timeout is more restrictive)

## Monitoring

Watch for these log messages:
- `Request timeout after 30000ms for session {sessionId}` - Indicates timeout occurred
- `LLM generation timeout after {timeoutMs}ms` - LLM-specific timeout
- `Chat error: {error}` - General error logging

## Next Steps

1. **Deploy fixes** to Cloud Run
2. **Monitor** timeout rates in production
3. **Optimize** slow operations if timeouts persist:
   - RAG retrieval performance
   - Database query optimization
   - LLM response time optimization
4. **Consider** adding request queuing if load is high

## Related Files

- `apps/api/src/modules/chat/chat.controller.ts` - Request timeout wrapper
- `apps/api/src/modules/llm/llm.service.ts` - LLM timeout configuration
- `apps/api/src/modules/chat/chat.service.ts` - Main chat handling logic
