---
allowed-tools: Bash, Read
argument-hint: "[start|resume <loop-id> --approve|--reject]"
---

# Run Suchi Quality Loop

You are running the Suchi quality improvement loop. The user's argument is: $ARGUMENTS

This is an automated eval -> diagnose -> plan -> fix -> rerun -> compare loop.

## Modes

### Mode: `start` (default)

Start a new quality loop. This will:

1. Run the eval suite against the API
2. Cluster failures by severity x frequency
3. Build a repair plan targeting the top failure cluster
4. Wait for approval before applying fixes

```bash
cd /home/gauta/suchi_repo/eval && npx ts-node cli.ts loop --api-url http://localhost:3001 --dataset ../evals/datasets/starter.jsonl
```

If the user specifies a different API URL or dataset, use those instead.

After the loop reaches WAIT_APPROVAL, show:
- Failure clusters table
- Repair plan (target, files, actions)
- How to approve/reject

### Mode: `resume <loop-id> --approve`

Resume a loop after approval:

```bash
cd /home/gauta/suchi_repo/eval && npx ts-node cli.ts loop --resume <loop-id> --approve
```

This will apply the fix (via Claude Code or manual), rerun evals, and compare.

### Mode: `resume <loop-id> --reject --reason "..."`

Reject the repair plan:

```bash
cd /home/gauta/suchi_repo/eval && npx ts-node cli.ts loop --resume <loop-id> --reject --reason "..."
```

### Mode: `status <loop-id>`

Show current loop state:

```bash
cd /home/gauta/suchi_repo/eval && npx ts-node cli.ts loop --status <loop-id>
```

## Output

Show the loop state transitions as they happen. At WAIT_APPROVAL, display the full repair plan for the user to review. After COMPARE, show the before/after score delta table.

## Constants

- **Repo root:** `/home/gauta/suchi_repo/`
- **Eval CLI:** `eval/cli.ts`
- **Default dataset:** `evals/datasets/starter.jsonl`
- **Default API:** `http://localhost:3001`
- **Loop state files:** `eval/loops/`
