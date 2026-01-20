# Handoff: Deploy Timeout Fixes to Cloud Run

**Date**: 2026-01-19  
**Assigned To**: @devops-gcp-deployer  
**Priority**: High  
**Status**: ✅ COMPLETED

## Task Summary

Deploy the timeout performance fixes to Cloud Run. These fixes address the second query timeout issue where users experience 15+ second hangs.

## Changes Deployed

**Commit**: `9d23679` - "Fix second query timeout: add 30s request timeout, increase LLM timeout to 15s"

**Files Changed**:
- `apps/api/src/modules/chat/chat.controller.ts` - Added 30s request timeout wrapper
- `apps/api/src/modules/llm/llm.service.ts` - Increased LLM timeout from 10s to 15s
- `docs/ops/PERFORMANCE_FIXES_2026-01-19.md` - Documentation

## Deployment Results

✅ **Build Status**: SUCCESS (5m 3s)  
✅ **Build ID**: `fc9ec4fa-f79e-43bc-8ed3-bcc061942485`  
✅ **Deployment**: Completed successfully

## Verification

- [x] Cloud Build completed successfully
- [x] New revision deployed to Cloud Run
- [ ] Service health check (pending)
- [ ] Test second query scenario (pending user testing)

## Expected Behavior

After deployment:
- Requests that take longer than 30s will timeout gracefully
- Users will see: "I'm experiencing high load. Please try again in a moment."
- LLM calls have 15s timeout (increased from 10s)
- Better error logging for debugging

## Testing Checklist

1. **First Query**: "What are common cancer symptoms?" (should work)
2. **Second Query**: "What is the difference between benign and malignant tumors?" (should complete or timeout gracefully)
3. **Monitor Logs**: Check for timeout events in Cloud Run logs

## Monitoring

Watch for these log messages:
- `Request timeout after 30000ms for session {sessionId}` - Indicates timeout occurred
- `LLM generation timeout after {timeoutMs}ms` - LLM-specific timeout
- `Chat error: {error}` - General error logging

## Related Documentation

- `docs/ops/PERFORMANCE_FIXES_2026-01-19.md` - Full details on the fixes
