#!/usr/bin/env python3
"""Fail if the Cloud Run runtime config drifts between deploy pipelines.

Cloud Run's --set-env-vars/--set-secrets REPLACE the full set on the service
(no merge), so any pipeline that deploys with a stale list silently wipes
config from production. This happened twice (Jun 27 and Jun 28, 2026).

Cloud Build (cloudbuild.yaml) is the single deployment authority; this script
asserts that every other pipeline that declares Cloud Run runtime config for
suchi-api stays byte-identical to it. Run locally or in CI:

    python3 scripts/check_deploy_config_parity.py
"""
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
CANONICAL = ("cloudbuild.yaml", "deploy-api")
# Pipelines that must match the canonical env/secret sets exactly: file -> API deploy step id.
MIRRORS = {"cloudbuild.gated.yaml": "deploy-candidate"}


def parse_kv(csv: str) -> dict:
    out = {}
    for item in csv.split(","):
        item = item.strip()
        if not item:
            continue
        key, _, value = item.partition("=")
        out[key.strip()] = value.strip()
    return out


def extract_cloudbuild(path: Path, step_id: str) -> tuple[dict, dict]:
    """Pull --set-env-vars / --set-secrets values for the deploy-api step.

    Deliberately line-based rather than yaml.safe_load so it needs no
    third-party deps in CI. The flag value is the next list item after the
    flag, within the step whose id is deploy-api.
    """
    lines = path.read_text().splitlines()
    step_ranges = []
    current = None
    for i, line in enumerate(lines):
        if re.match(r"\s*-\s+name:", line) and "steps" not in line:
            if current is not None:
                step_ranges.append((current, i))
            current = i
    if current is not None:
        step_ranges.append((current, len(lines)))

    for start, end in step_ranges:
        block = lines[start:end]
        if not any(re.search(rf"id:\s*'?{step_id}'?\s*$", l) for l in block):
            continue
        found = {}
        for flag in ("--set-env-vars", "--set-secrets"):
            for j, line in enumerate(block):
                if flag in line and j + 1 < len(block):
                    value = block[j + 1].strip().lstrip("-").strip().strip("'\"")
                    found[flag] = parse_kv(value)
        if "--set-env-vars" in found and "--set-secrets" in found:
            return found["--set-env-vars"], found["--set-secrets"]
    raise SystemExit(f"{path.name}: could not locate {step_id} step with --set-env-vars/--set-secrets")


def normalize(kv: dict) -> dict:
    return {k: v.replace("${PROJECT_ID}", "gen-lang-client-0202543132") for k, v in kv.items()}


def diff(kind: str, canonical: dict, mirror: dict, mirror_name: str) -> list[str]:
    problems = []
    for key in sorted(set(canonical) | set(mirror)):
        if key not in mirror:
            problems.append(f"  {mirror_name} is MISSING {kind} {key}")
        elif key not in canonical:
            problems.append(f"  {mirror_name} has EXTRA {kind} {key} (not in the canonical pipeline)")
        elif canonical[key] != mirror[key]:
            problems.append(f"  {mirror_name} {kind} {key}: {mirror[key]!r} != canonical {canonical[key]!r}")
    return problems


def main() -> int:
    canon_file, canon_step = CANONICAL
    canon_env, canon_sec = (normalize(d) for d in extract_cloudbuild(REPO_ROOT / canon_file, canon_step))
    print(f"canonical ({canon_file}): {len(canon_env)} env vars, {len(canon_sec)} secrets")

    problems = []
    for mirror, step_id in MIRRORS.items():
        env, sec = (normalize(d) for d in extract_cloudbuild(REPO_ROOT / mirror, step_id))
        print(f"checking {mirror}: {len(env)} env vars, {len(sec)} secrets")
        problems += diff("env var", canon_env, env, mirror)
        problems += diff("secret", canon_sec, sec, mirror)

    if problems:
        print("\nCONFIG DRIFT DETECTED:")
        print("\n".join(problems))
        print(f"\nFix: make the mirror(s) byte-identical to {CANONICAL[0]} (the single deployment authority).")
        return 1
    print("OK: all deploy pipelines carry identical Cloud Run runtime config.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
