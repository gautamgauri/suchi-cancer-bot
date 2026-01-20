---
name: ORCHESTRATOR_PROMPT
model: fast
---

# Master Orchestrator Prompt

Use this prompt at the start of every parallel agent session to keep all agents aligned:

---

**"We are making a single PR-sized change. No refactors. Follow file boundaries. Use the handoff format. Treat safety behavior as invariant. DoD commands must be runnable as written. When problems are found, route directly to specialized developers (see ROUTING_GUIDE.md)."**

---

## Usage

1. Paste this prompt at the start of your chat session
2. Then delegate specific tasks to sub-agents
3. All agents will follow these constraints automatically
4. When problems are identified, use the routing guide to delegate

## What it enforces

- **Single PR-sized change**: Prevents scope creep
- **No refactors**: Only touch what's needed for the task
- **File boundaries**: Respects allowed/forbidden paths per agent
- **Handoff format**: Ensures consistent delivery (files changed, what changed, how to verify, risks)
- **Safety invariants**: Safety behavior is treated as immutable
- **Runnable DoD commands**: All verification commands must work as written
- **Direct routing**: Problems route to specialized developers, no intermediate layers