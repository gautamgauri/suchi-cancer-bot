#!/usr/bin/env python3
"""
One-off, offline geocoder for the Suchi Navigator hospital directory (issue #103).

Why this is a script and not a runtime call
-------------------------------------------
The API never calls a geocoder. Coordinates are resolved once, here, and
committed into the tracked JSON, so there is no runtime API key, no runtime
latency, no runtime failure mode, and — per AGENTS.md section 3 — no new env var
to keep in sync across `cloudbuild.yaml` and `cloudbuild.gated.yaml`. It also
means the geocoded data lands in a reviewable PR diff, which is the only way the
"validated, never inferred" requirement in #103 becomes checkable rather than
asserted.

Source
------
Public Nominatim (OpenStreetMap), no key required, rate-limited to 1 request per
second per its usage policy, with a descriptive User-Agent naming the operator
and a contact URL. Locality-level precision is adequate for ordering cancer
centres that are tens of kilometres apart; it is NOT adequate for turn-by-turn
navigation, and nothing downstream should treat it that way.

Hard gates (a failure writes NO coordinate)
-------------------------------------------
1. The returned address must contain the record's own `city` AND `state`
   (case-insensitive, with a small table of common Indian spelling variants).
2. The point must fall inside the India bounding box
   (lat 6.5..37.5, lon 68.0..97.5).

A fabricated coordinate for a facility a sick patient travels to is the worst
failure available here, so a record that fails either gate keeps no coordinate
at all and is appended to `scripts/geocode-unresolved.json` for manual review.
There is no silent third state: every record either carries coordinates or
appears in that file.

Idempotent
----------
Records that already carry a validated `latitude`/`longitude` are skipped, so
re-running costs nothing and never churns the diff. `--force` re-geocodes.

Usage
-----
    python3 scripts/geocode-hospitals.py                # hospitals.json
    python3 scripts/geocode-hospitals.py --cities       # INDIAN_CITIES in the TS table
    python3 scripts/geocode-hospitals.py --dry-run      # resolve, report, write nothing
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

# ─── Paths ──────────────────────────────────────────────────────────────────

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# The tracked source of truth. `apps/api/data/hospitals.json` is a SYMLINK to
# this file — one file, not two — so writing here updates both views.
HOSPITALS_JSON = os.path.join(
    REPO_ROOT, "apps", "landing", "src", "content", "hospitals.json"
)
CITIES_TS = os.path.join(
    REPO_ROOT, "apps", "api", "src", "modules", "chat", "utils", "location-detector.ts"
)
UNRESOLVED_JSON = os.path.join(REPO_ROOT, "scripts", "geocode-unresolved.json")

# ─── Source configuration ───────────────────────────────────────────────────

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
GEOCODE_SOURCE = "nominatim"

# Nominatim's usage policy requires a descriptive User-Agent identifying the
# application and a way to contact the operator.
USER_AGENT = (
    "SCCF-Suchi-CancerNavigator/1.0 "
    "(Suchitra Cancer Care Foundation; hospital directory geocoding; "
    "contact: https://github.com/gautamgauri/suchi-cancer-bot/issues/103)"
)

# Nominatim asks for at most 1 request per second from a single source.
RATE_LIMIT_SECONDS = 1.1
REQUEST_TIMEOUT_SECONDS = 30
MAX_ATTEMPTS = 3

# ─── Gate 2: India bounding box ─────────────────────────────────────────────
# Deliberately generous — this catches a mangled query returning a
# plausible-looking point on another continent, not near-border imprecision.
INDIA_LAT_MIN, INDIA_LAT_MAX = 6.5, 37.5
INDIA_LON_MIN, INDIA_LON_MAX = 68.0, 97.5

# ─── Gate 1: common Indian spelling variants ────────────────────────────────
# Nominatim may answer with either the current official name or the older one.
# Each group is a set of names that count as the same place for the gate.
NAME_VARIANTS = [
    {"bengaluru", "bangalore", "bangalooru"},
    {"kolkata", "calcutta"},
    {"mumbai", "bombay"},
    {"chennai", "madras"},
    {"puducherry", "pondicherry", "pondichery"},
    {"prayagraj", "allahabad"},
    {"thiruvananthapuram", "trivandrum"},
    {"varanasi", "banaras", "benares", "kashi"},
    {"gurugram", "gurgaon"},
    {"new delhi", "delhi", "nct of delhi", "national capital territory of delhi"},
    {"odisha", "orissa"},
    {"uttarakhand", "uttaranchal"},
    {"tamil nadu", "tamilnadu"},
    {"guwahati", "gauhati"},
    {"mysuru", "mysore"},
    {"vadodara", "baroda"},
    {"kanpur", "cawnpore"},
    {"shimla", "simla"},
    {"kochi", "cochin"},
    {"visakhapatnam", "vishakhapatnam", "vizag"},
    {"muzaffarpur", "mujaffarpur"},
    {"siliguri", "shiliguri"},
    {"manipal", "udupi"},  # Manipal is a township inside Udupi district
]


def variants_of(name: str) -> set[str]:
    """Every accepted spelling of `name`, lowercased."""
    low = name.strip().lower()
    out = {low}
    for group in NAME_VARIANTS:
        if low in group:
            out |= group
    return out


# ─── HTTP ───────────────────────────────────────────────────────────────────

_last_request_at = 0.0


def _throttle() -> None:
    global _last_request_at
    elapsed = time.time() - _last_request_at
    if elapsed < RATE_LIMIT_SECONDS:
        time.sleep(RATE_LIMIT_SECONDS - elapsed)
    _last_request_at = time.time()


def nominatim_search(query: str) -> list[dict]:
    """One rate-limited Nominatim lookup. Returns [] on any transport failure."""
    params = urllib.parse.urlencode(
        {
            "q": query,
            "format": "jsonv2",
            "limit": "3",
            "addressdetails": "1",
            "countrycodes": "in",
        }
    )
    url = f"{NOMINATIM_URL}?{params}"

    for attempt in range(1, MAX_ATTEMPTS + 1):
        _throttle()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SECONDS) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001 — transport errors are all retryable
            if attempt == MAX_ATTEMPTS:
                print(f"    ! request failed after {MAX_ATTEMPTS} attempts: {exc}")
                return []
            time.sleep(2 * attempt)
    return []


# ─── Gates ──────────────────────────────────────────────────────────────────


def returned_address_text(hit: dict) -> str:
    """
    The address Nominatim returned, as one searchable string: the display name
    plus the structured address fields (the same address, decomposed — a
    district or county field often carries the city name when the display name
    does not).
    """
    parts = [str(hit.get("display_name", ""))]
    address = hit.get("address") or {}
    parts.extend(str(v) for v in address.values())
    return " | ".join(parts).lower()


def gate_city_and_state(hit: dict, city: str, state: str) -> tuple[bool, str]:
    """Gate 1 — the returned address must name both the city and the state."""
    haystack = returned_address_text(hit)
    city_ok = any(v in haystack for v in variants_of(city))
    state_ok = any(v in haystack for v in variants_of(state))
    if city_ok and state_ok:
        return True, ""
    missing = []
    if not city_ok:
        missing.append(f"city {city!r}")
    if not state_ok:
        missing.append(f"state {state!r}")
    return False, (
        f"returned address does not contain {' and '.join(missing)}: "
        f"{hit.get('display_name', '')!r}"
    )


def gate_inside_india(lat: float, lon: float) -> tuple[bool, str]:
    """Gate 2 — a point outside India means the query was mangled."""
    if INDIA_LAT_MIN <= lat <= INDIA_LAT_MAX and INDIA_LON_MIN <= lon <= INDIA_LON_MAX:
        return True, ""
    return False, (
        f"point ({lat}, {lon}) is outside the India bounding box "
        f"(lat {INDIA_LAT_MIN}..{INDIA_LAT_MAX}, lon {INDIA_LON_MIN}..{INDIA_LON_MAX})"
    )


# On a locality query Nominatim will happily answer with the DISTRICT that
# shares the city's name, whose centroid can sit tens of kilometres from the
# town itself — "Darbhanga, Bihar" returns the district at (26.083, 86.032)
# ahead of the city at (26.157, 85.900), a 15km error in the origin of every
# distance we compute from it. So on the locality tier, prefer a result that is
# actually a populated place.
SETTLEMENT_ADDRESS_TYPES = [
    "city",
    "town",
    "municipality",
    "village",
    "suburb",
    "neighbourhood",
    "hamlet",
]


def _settlement_rank(hit: dict) -> int:
    """Lower is better. Non-settlement results sort last."""
    addresstype = str(hit.get("addresstype", "")).lower()
    if addresstype in SETTLEMENT_ADDRESS_TYPES:
        return SETTLEMENT_ADDRESS_TYPES.index(addresstype)
    return len(SETTLEMENT_ADDRESS_TYPES)


def try_queries(
    queries: list[tuple[str, str]], city: str, state: str
) -> tuple[dict | None, list[str]]:
    """
    Walk the query tiers most-specific first, returning the best hit from the
    first tier that yields one clearing BOTH gates, along with every rejection
    reason seen on the way.

    Within a tier, "best" means the first gate-passing hit — except on the
    locality (`city`) tier, where a populated-place result beats a
    same-named district or county (see SETTLEMENT_ADDRESS_TYPES).
    """
    rejections: list[str] = []

    for confidence, query in queries:
        hits = nominatim_search(query)
        if not hits:
            rejections.append(f"[{confidence}] no result for {query!r}")
            continue

        passing: list[tuple[dict, float, float]] = []
        for hit in hits:
            try:
                lat = round(float(hit["lat"]), 4)
                lon = round(float(hit["lon"]), 4)
            except (KeyError, TypeError, ValueError):
                rejections.append(f"[{confidence}] unparseable coordinates in result")
                continue

            ok, why = gate_inside_india(lat, lon)
            if not ok:
                rejections.append(f"[{confidence}] {why}")
                continue

            ok, why = gate_city_and_state(hit, city, state)
            if not ok:
                rejections.append(f"[{confidence}] {why}")
                continue

            passing.append((hit, lat, lon))

        if not passing:
            continue

        if confidence == "city":
            passing.sort(key=lambda p: _settlement_rank(p[0]))

        hit, lat, lon = passing[0]
        return (
            {
                "latitude": lat,
                "longitude": lon,
                "geocode_source": GEOCODE_SOURCE,
                "geocode_confidence": confidence,
                "display_name": hit.get("display_name", ""),
            },
            rejections,
        )

    return None, rejections


# ─── Unresolved log ─────────────────────────────────────────────────────────


def load_unresolved() -> dict:
    if os.path.exists(UNRESOLVED_JSON):
        with open(UNRESOLVED_JSON, encoding="utf-8") as fh:
            return json.load(fh)
    return {
        "_meta": {
            "description": (
                "Records the geocoder could not resolve within its hard gates. "
                "Every hospital and city either carries coordinates or appears "
                "here — there is no silent third state. Entries need manual "
                "review; do NOT hand-enter a coordinate without a source."
            ),
            "gates": {
                "city_state": "returned address must contain the record's own city AND state",
                "india_bbox": f"lat {INDIA_LAT_MIN}..{INDIA_LAT_MAX}, lon {INDIA_LON_MIN}..{INDIA_LON_MAX}",
            },
            "last_run": None,
        },
        "hospitals": [],
        "cities": [],
    }


def save_unresolved(doc: dict) -> None:
    doc["_meta"]["last_run"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    with open(UNRESOLVED_JSON, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, indent=2, ensure_ascii=False)
        fh.write("\n")


# ─── Mode: hospitals ────────────────────────────────────────────────────────


def hospital_queries(hospital: dict) -> list[tuple[str, str]]:
    """
    Query tiers, most specific first. `geocode_confidence` records WHICH TIER
    ANSWERED — `name_address` > `address` > `city` — and nothing stronger than
    that. It is not a claim that the hospital building itself was pinpointed:
    on the `address` tier Nominatim often returns a nearby landmark in the same
    locality (a road, a bank, a railway station), which is accurate to a
    neighbourhood, not to a gate. That is sufficient for the only thing these
    coordinates are used for — ordering centres that are tens of kilometres
    apart — and is why no caller may render a street address or a travel time
    from them.
    """
    city = hospital["city"]
    state = hospital["state"]
    name = hospital.get("name", "")
    address = (hospital.get("contact") or {}).get("address") or ""

    # Strip a trailing "- 801505" pincode into a clean token Nominatim parses.
    address_clean = re.sub(r"\s*-\s*(\d{6})\b", r", \1", address).strip()

    tiers: list[tuple[str, str]] = []
    if name:
        tiers.append(("name_address", f"{name}, {address_clean or city}, {state}, India"))
    if address_clean and address_clean.lower() != f"{city}, {state}".lower():
        tiers.append(("address", f"{address_clean}, {state}, India"))
    tiers.append(("city", f"{city}, {state}, India"))
    return tiers


def run_hospitals(args: argparse.Namespace) -> int:
    with open(HOSPITALS_JSON, encoding="utf-8") as fh:
        doc = json.load(fh)

    hospitals = doc["hospitals"]
    unresolved = load_unresolved()
    unresolved["hospitals"] = []

    resolved = skipped = failed = 0

    for i, hospital in enumerate(hospitals, 1):
        hid = hospital["id"]
        city, state = hospital["city"], hospital["state"]

        if not args.force and hospital.get("latitude") is not None:
            skipped += 1
            continue

        print(f"[{i}/{len(hospitals)}] {hid} ({city}, {state})")
        hit, rejections = try_queries(hospital_queries(hospital), city, state)

        if hit is None:
            failed += 1
            print("    ✗ unresolved")
            for reason in rejections:
                print(f"      - {reason}")
            unresolved["hospitals"].append(
                {
                    "id": hid,
                    "name": hospital.get("name"),
                    "city": city,
                    "state": state,
                    "address": (hospital.get("contact") or {}).get("address"),
                    "reasons": rejections,
                }
            )
            continue

        resolved += 1
        print(
            f"    ✓ {hit['latitude']}, {hit['longitude']} "
            f"[{hit['geocode_confidence']}] {hit['display_name'][:90]}"
        )
        if not args.dry_run:
            hospital["latitude"] = hit["latitude"]
            hospital["longitude"] = hit["longitude"]
            hospital["geocode_source"] = hit["geocode_source"]
            hospital["geocode_confidence"] = hit["geocode_confidence"]
            hospital["geocoded_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    if not args.dry_run:
        with open(HOSPITALS_JSON, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, indent=2, ensure_ascii=False)
            fh.write("\n")
        save_unresolved(unresolved)

    total_with_coords = sum(1 for h in hospitals if h.get("latitude") is not None)
    print(
        f"\nhospitals: {resolved} resolved, {skipped} already had coordinates, "
        f"{failed} unresolved — {total_with_coords}/{len(hospitals)} now carry coordinates"
    )
    return 0 if failed == 0 else 1


# ─── Mode: cities ───────────────────────────────────────────────────────────

# One INDIAN_CITIES entry per line, e.g.
#   { canonical: 'Patna', state: 'Bihar', aliases: ['patna', 'patnaa'] },
CITY_LINE_RE = re.compile(
    r"^(?P<indent>\s*)\{\s*canonical:\s*'(?P<canonical>[^']+)',\s*"
    r"state:\s*'(?P<state>[^']+)',\s*"
    r"aliases:\s*\[(?P<aliases>[^\]]*)\]"
    r"(?P<rest>.*?)\},\s*$"
)


def run_cities(args: argparse.Namespace) -> int:
    with open(CITIES_TS, encoding="utf-8") as fh:
        lines = fh.read().split("\n")

    unresolved = load_unresolved()
    unresolved["cities"] = []

    resolved = skipped = failed = 0
    entries = 0

    for idx, line in enumerate(lines):
        match = CITY_LINE_RE.match(line)
        if not match:
            continue
        entries += 1

        canonical = match.group("canonical")
        state = match.group("state")
        rest = match.group("rest")

        if not args.force and "coords:" in rest:
            skipped += 1
            continue

        print(f"[city {entries}] {canonical}, {state}")
        hit, rejections = try_queries(
            [("city", f"{canonical}, {state}, India")], canonical, state
        )

        if hit is None:
            failed += 1
            print("    ✗ unresolved")
            for reason in rejections:
                print(f"      - {reason}")
            unresolved["cities"].append(
                {"canonical": canonical, "state": state, "reasons": rejections}
            )
            continue

        resolved += 1
        print(
            f"    ✓ {hit['latitude']}, {hit['longitude']} "
            f"{hit['display_name'][:90]}"
        )
        if not args.dry_run:
            coords = f", coords: [{hit['latitude']}, {hit['longitude']}]"
            cleaned_rest = re.sub(r",\s*coords:\s*\[[^\]]*\]", "", rest)
            lines[idx] = (
                f"{match.group('indent')}{{ canonical: '{canonical}', "
                f"state: '{state}', aliases: [{match.group('aliases')}]"
                f"{cleaned_rest}{coords} }},"
            )

    if not args.dry_run:
        with open(CITIES_TS, "w", encoding="utf-8") as fh:
            fh.write("\n".join(lines))
        save_unresolved(unresolved)

    print(
        f"\ncities: {resolved} resolved, {skipped} already had coordinates, "
        f"{failed} unresolved — of {entries} entries"
    )
    return 0 if failed == 0 else 1


# ─── Entry point ────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--cities",
        action="store_true",
        help="geocode the INDIAN_CITIES table in location-detector.ts instead of hospitals.json",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="re-geocode records that already carry coordinates",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="resolve and report, but write nothing",
    )
    args = parser.parse_args()

    return run_cities(args) if args.cities else run_hospitals(args)


if __name__ == "__main__":
    sys.exit(main())
