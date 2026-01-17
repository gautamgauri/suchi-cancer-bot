# Handoff Thread: [DATE] - [TICKET_NAME]

## Baseline Capture

**Date:** [YYYY-MM-DD]
**Ticket:** [Brief description]

### Tier1 Baseline
```
[Paste output from: cd eval && npm run eval:tier1]
Or reference: eval/reports/tier1-summary.txt from [timestamp]
```

---

## Agent Handoffs

### @tests-eval-author

**Files changed:**
- 

**What changed:**
1. 
2. 
3. 

**How to verify:**
- Command: 
- Expected signals: 

**Risks / edge cases:**
1. 
2. 

---

### @retrieval-engineer

**Files changed:**
- 

**What changed:**
1. 
2. 
3. 

**How to verify:**
- Command: 
- Expected signals: 

**Risks / edge cases:**
1. 
2. 

---

### @verifier

**Files changed:**
- 

**What changed:**
1. 
2. 
3. 

**How to verify:**
- Command: 
- Expected signals: 

**Risks / edge cases:**
1. 
2. 

---

## Command Outputs

### Build Output
```
[Paste: cd apps/api && npm run build]
```

### Test Output
```
[Paste: cd apps/api && npm test]
```

### Tier1 Eval Output
```
[Paste: cd eval && npm run eval:tier1]
```

---

## Tier1 Comparison

### Baseline Metrics
```
[Paste baseline tier1-summary.txt or key metrics]
```

### Current Metrics
```
[Paste current tier1-summary.txt or key metrics]
```

### Delta Analysis
- Improved cases: 
- Stable cases: 
- Regressed cases: 

---

## Conductor Integration Report

[Run @conductor with this handoff file to generate integration report]
