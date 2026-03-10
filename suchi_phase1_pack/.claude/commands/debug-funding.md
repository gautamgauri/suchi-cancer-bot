---
allowed-tools: Bash, Read, Grep, Glob
argument-hint: "[all|fellowship|imports|routes|types]"
---

# Debug Funding Bot Codebase

Run diagnostic checks on the funding-api codebase. The user's argument is: $ARGUMENTS

Parse the scope from the argument. Default to `all` if no argument is given.

## Scopes

- **`all`** (default): Run all checks below
- **`fellowship`**: Only fellowship pipeline checks (checks 1-4)
- **`imports`**: Only import/DI checks (check 5)
- **`routes`**: Only route checks (check 6)
- **`types`**: Only type consistency checks (check 7)

---

## Check 1: TypeScript Build

```bash
cd /home/gauta/suchi_repo/suchi_phase1_pack/apps/funding-api && npx tsc --noEmit 2>&1
```

- PASS: exit code 0, no output
- FAIL: show all errors

---

## Check 2: Fellowship Pipeline Completeness

Verify all 5 strategy stages (A–E) are wired into the pipeline:

1. Read `apps/funding-api/src/modules/fellowship/fellowship.service.ts`
2. Confirm it imports and injects all 5 services:
   - `OpportunityInterpreterService`
   - `NarrativeSynthesizerService`
   - `BridgeSelectorService`
   - `SectionPlannerService`
   - `FellowshipCriticService`
3. Confirm each is called in `generateFellowship()` (search for stage log messages):
   - `FELLOWSHIP_STAGE_A_COMPLETE`
   - `FELLOWSHIP_STAGE_B_COMPLETE`
   - `FELLOWSHIP_STAGE_C_COMPLETE`
   - `FELLOWSHIP_STAGE_D_COMPLETE`
   - `FELLOWSHIP_STAGE_E_COMPLETE`
4. Confirm `stripPipelineTags` is imported and called

- PASS: all 5 services injected and all 5 stage logs present
- FAIL: list missing services or stages

---

## Check 3: Fellowship Module Registration

Read `apps/funding-api/src/modules/fellowship/fellowship.module.ts` and verify all 5 new services are in the `providers` array:

- `OpportunityInterpreterService`
- `BridgeSelectorService`
- `NarrativeSynthesizerService`
- `SectionPlannerService`
- `FellowshipCriticService`

- PASS: all 5 registered
- FAIL: list missing providers

---

## Check 4: Fellowship Prompt ↔ Service Contract

For each of the 5 new prompt files in `fellowship/prompts/`:
1. Verify the prompt file exports a system prompt constant and a builder function
2. Verify the corresponding service file imports from the correct prompt file
3. Verify the service calls `this.llm.generatePlain()` and `JSON.parse()`

Prompt files to check:
- `opportunity-interpreter.prompt.ts` ↔ `services/opportunity-interpreter.service.ts`
- `bridge-selector.prompt.ts` ↔ `services/bridge-selector.service.ts`
- `narrative-synthesizer.prompt.ts` ↔ `services/narrative-synthesizer.service.ts`
- `section-planner.prompt.ts` ↔ `services/section-planner.service.ts`
- `fellowship-critic.prompt.ts` ↔ `services/fellowship-critic.service.ts`

- PASS: all prompt/service pairs consistent
- FAIL: list broken contracts

---

## Check 5: Import Graph & Circular Dependency Scan

Check for potential circular imports in the fellowship module:

```bash
cd /home/gauta/suchi_repo/suchi_phase1_pack/apps/funding-api && \
  grep -rn "from.*fellowship" src/modules/fellowship/ --include='*.ts' | \
  grep -v node_modules | grep -v '.spec.ts'
```

Analyze the output:
- Services should only import from `../prompts/`, `../fellowship-pipeline.types`, and `../../core_ai/`
- Prompts should NOT import from services
- No file should import from itself

- PASS: no circular patterns detected
- FAIL: list suspicious import chains

---

## Check 6: Route Prefix Audit

Scan ALL controllers in funding-api for doubled `/v1/v1/` routes. The app sets `app.setGlobalPrefix("v1")`, so controllers should NOT include `v1/` in their `@Controller()` decorator.

```bash
grep -rn '@Controller(' /home/gauta/suchi_repo/suchi_phase1_pack/apps/funding-api/src/ --include='*.ts'
```

For each `@Controller("...")` found:
- PASS: path does NOT start with `v1/`
- FAIL: path starts with `v1/` → will produce doubled `/v1/v1/` routes

Also check for any literal `/v1/v1/` strings in the source:

```bash
grep -rn '/v1/v1/' /home/gauta/suchi_repo/suchi_phase1_pack/apps/funding-api/src/ --include='*.ts'
```

---

## Check 7: Type Consistency (fellowship-pipeline.types.ts)

Read `fellowship/fellowship-pipeline.types.ts` and verify:
1. All 5 interfaces are exported: `FellowshipInterpretation`, `ApplicantNarrative`, `FellowshipBridge`, `SectionPlan`, `FellowshipCriticResult`
2. Each service's return type matches the corresponding interface (grep for `as FellowshipInterpretation`, `as ApplicantNarrative`, etc.)
3. The `fellowship.service.ts` imports all needed types from `fellowship-pipeline.types`

- PASS: all types consistent
- FAIL: list mismatches

---

## Check 8: Tag Stripper Coverage

Read `fellowship/utils/tag-stripper.ts` and verify it handles all known tag patterns:
- `[citation:...]`
- `{{MISSING:...}}`
- `[UNVERIFIED_NUMERIC_CLAIM...]`
- UUID patterns
- eval opportunity ID patterns (`eval-cat...`)

Then grep the codebase for any OTHER tag patterns that might leak into output:

```bash
grep -rn --include='*.ts' -E '\[citation:|MISSING:|UNVERIFIED_NUMERIC_CLAIM|eval-cat[0-9]' \
  /home/gauta/suchi_repo/suchi_phase1_pack/apps/funding-api/src/modules/fellowship/
```

- PASS: all known patterns covered, no unknown patterns found
- FAIL: list uncovered patterns

---

## Results Table

After running all in-scope checks, display:

```
## Debug Results

| #  | Check                          | Result      | Details          |
|----|--------------------------------|-------------|------------------|
| 1  | TypeScript build               | PASS / FAIL | ...              |
| 2  | Pipeline completeness          | PASS / FAIL | ...              |
| 3  | Module registration            | PASS / FAIL | ...              |
| 4  | Prompt ↔ Service contract      | PASS / FAIL | ...              |
| 5  | Import graph / circular deps   | PASS / FAIL | ...              |
| 6  | Route prefix audit             | PASS / FAIL | ...              |
| 7  | Type consistency               | PASS / FAIL | ...              |
| 8  | Tag stripper coverage          | PASS / FAIL | ...              |
```

If any check FAILed, provide a **Fix suggestions** section with specific file:line references and recommended changes.

## Constants

- **Funding API source:** `/home/gauta/suchi_repo/suchi_phase1_pack/apps/funding-api/src/`
- **Fellowship module:** `apps/funding-api/src/modules/fellowship/`
- **Pipeline types:** `apps/funding-api/src/modules/fellowship/fellowship-pipeline.types.ts`
- **Main entry:** `apps/funding-api/src/main.ts` (sets `v1` global prefix)
