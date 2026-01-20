# Handoff: Deploy Urgent Response Template Fix (Locale-Aware + Concrete Steps)

**Date**: 2026-01-19  
**Assigned To**: @devops-gcp-deployer  
**Priority**: High  
**Status**: ✅ **DEPLOYED** (Build ID: 3ea88cfe-aeb3-4fd2-92eb-1dfbe7739821)

## Summary

Deploy fix for urgent response template (S2) that:
1. Adds **concrete immediate steps** (fixes `what_to_do_now` eval failure)
2. Uses **locale-aware emergency numbers** (112/108 for India, 911 for others)

## Files Modified

1. **`apps/api/src/modules/chat/response-templates.ts`**
   - Updated `S2()` method to include concrete immediate steps
   - Added locale detection (India vs others)
   - Uses 112 (emergency) and 108 (ambulance) for India
   - Uses 911 for other locales

2. **`apps/api/src/modules/chat/chat.service.ts`**
   - Updated urgent response path to pass `locale` to S2 template
   - Line ~137: Passes `session.locale || dto.locale` to template

## Changes Details

### Template Changes (response-templates.ts)

**Before**: Generic "seek emergency care" without concrete steps

**After**: 
- Locale-aware emergency numbers
- Concrete immediate steps:
  - "Call 112 or 108 for ambulance" (India) / "Call 911" (others)
  - "Don't drive yourself if you're feeling faint"
  - "Apply gentle pressure if bleeding"
  - "Bring medication list"
  - "Have someone call ahead to ER"

### Service Changes (chat.service.ts)

**Before**:
```typescript
let urgentResponse = ResponseTemplates.S2({ isFirstMessage, userText: dto.userText } as any);
```

**After**:
```typescript
let urgentResponse = ResponseTemplates.S2({ 
  isFirstMessage, 
  userText: dto.userText,
  locale: session.locale || dto.locale 
} as any);
```

## Expected Improvements

After deployment:
- ✅ `what_to_do_now` eval check should pass (concrete immediate steps provided)
- ✅ Correct emergency numbers for India (112/108) vs others (911)
- ✅ Better user experience with actionable safety guidance

## Deployment Steps

1. **Build and verify**:
   ```bash
   cd apps/api
   npm run build
   ```

2. **Deploy to GCP**:
   ```bash
   gcloud builds submit --config cloudbuild.yaml
   ```

3. **Verify deployment**:
   - Check Cloud Run service is healthy
   - Test urgent response with India locale (should show 112/108)
   - Test urgent response with US locale (should show 911)

## Testing

After deployment, verify:
1. **India locale**: Urgent response shows "Call 112 or 108 for ambulance"
2. **Other locales**: Urgent response shows "Call 911"
3. **Concrete steps present**: All immediate steps are in the response

## Eval Verification

After deployment, `@tests-eval-author` should re-run RQ-ORAL-01:
```bash
cd eval
npm run eval -- run --cases cases/tier1/retrieval_quality_sample.yaml --output reports/tier1-urgent-template-fix.json --summary
```

Expected:
- `what_to_do_now`: Should pass ✅
- Score should improve from 69.1%

## Rollback Plan

If issues occur:
1. Revert to previous commit
2. Re-deploy via Cloud Build
3. Verify service returns to previous behavior

## Allowed Paths

- `apps/api/src/modules/chat/response-templates.ts` ✅
- `apps/api/src/modules/chat/chat.service.ts` ✅
- `cloudbuild.yaml` ✅
- `docs/ops/handoffs/**` ✅

## Related Handoffs

- `docs/ops/handoffs/2026-01-19-safety-gatekeeper-urgent-concrete-steps.md` - Original analysis
- `docs/ops/handoffs/2026-01-19-safety-gatekeeper-urgent-extractor-integration.md` - Updated analysis (extractor not needed)
