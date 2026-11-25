/**
 * The reply to "where can I get treatment" questions (issue #260): the
 * hospital directory, and only the directory. Knowledge base articles never
 * supply the hospital list.
 *
 *  - No place recognised: one short question asking for the city or state.
 *    No list, and no national centres appended.
 *  - A place recognised and the directory holds centres there: those centres.
 *  - A place recognised but no centre there: say so. Centres elsewhere are
 *    shown only with their city and state, and with a distance when both ends
 *    are geocoded. When nothing near is known, no list at all.
 *  - Every answer ends with how to find a PM-JAY empanelled hospital, from the
 *    verified file.
 *
 * Each centre is stated in the reviewed words of the navigation template
 * (renderHospitalBullet), with the "confirm with the hospital" sentence. The
 * directory service drops held, excluded and unreviewed fields (PR #263).
 */

import type { HospitalSearchOutcome } from "../hospital-directory.service";
import { HOSPITAL_CONFIRMATION_SENTENCE, renderHospitalBullet } from "../hospital-directory-render";
import type { PlaceResult } from "../utils/location-detector";
import { pmjayFinderLines } from "./financial-support";

/**
 * Routing is stateless, so a bare "Patna" sent next would not be joined to
 * this question. The reply asks for the whole question again, with the place.
 */
export const ASK_PLACE_REPLY =
  "Which city or state are you asking about? Please send your question again with the place in it, for example \"cancer hospitals in Patna\".";

const DISTANCE_NOTE = "Distances are approximate. The distance by road or rail is longer.";

function placeName(place: PlaceResult): string {
  return place.city ?? place.state;
}

function inCity(hCity: string, city: string): boolean {
  const a = hCity.toLowerCase();
  const b = city.toLowerCase();
  return a.includes(b) || b.includes(a);
}

/**
 * Build the hospital answer for a recognised place from a pooled directory
 * search (regional and national centres together).
 */
export function buildHospitalAnswer(place: PlaceResult, outcome: HospitalSearchOutcome, maxItems = 5): string {
  const { results, geography } = outcome;
  const name = placeName(place);
  const lines: string[] = [];
  // The directory files a few centres twice (one record per pool). Show each
  // name once.
  // Duplicates are caught by id, short name or full name.
  const seen = new Set<string>();
  const unique = results.filter((h) => {
    const keys = [h.id, h.short_name, h.name].filter(Boolean).map((k) => `${k}`.trim().toLowerCase());
    if (keys.some((k) => seen.has(k))) return false;
    keys.forEach((k) => seen.add(k));
    return true;
  });
  // Within the same distance (to the nearest 10 km, as shown), public and
  // National Cancer Grid centres come first, then trusts, then private
  // hospitals. Otherwise the directory's order is kept. The directory's own
  // order within a distance is alphabetical, which put five private hospitals
  // ahead of Tata Memorial in Mumbai.
  const rank = (h: (typeof unique)[number]) =>
    /government|tmc/i.test(h.type ?? "") || h.ncg_member === true ? 0 : /trust/i.test(h.type ?? "") ? 1 : 2;
  // The same buckets the reply shows: "within 10 km", then "about N km".
  const bucket = (h: (typeof unique)[number]) =>
    typeof h.distance_km !== "number" || h.distance_km < 10 ? 0 : Math.round(h.distance_km / 10);
  unique.sort((a, b) => bucket(a) - bucket(b) || rank(a) - rank(b));
  // When the list holds centres in the city itself, show only those. Centres
  // further away are shown only when there is none in the city, and then the
  // lead line says so.
  const local = place.city ? unique.filter((h) => inCity(h.city, place.city!)) : [];
  const anyInCity = local.length > 0;
  const shown = (anyInCity ? local : unique).slice(0, anyInCity || !place.city ? maxItems : 3);

  switch (shown.length === 0 ? "none" : geography.stage) {
    case "city":
      lines.push(`Cancer centres in ${place.city}, from Suchi's hospital list:`);
      break;
    case "distance":
      lines.push(
        anyInCity
          ? `Cancer centres in ${place.city}, from Suchi's hospital list:`
          : `Suchi's hospital list has no cancer centre in ${place.city}. These are the nearest centres it lists, nearest first. ${DISTANCE_NOTE}`
      );
      break;
    case "state":
      lines.push(
        place.city
          ? `Suchi's hospital list has no cancer centre in ${place.city}. These are the centres it lists in ${place.state}:`
          : `Cancer centres in ${place.state}, from Suchi's hospital list:`
      );
      break;
    case "adjacent_state":
      lines.push(`Suchi's hospital list has no cancer centre in ${name}. These centres are in neighbouring states:`);
      break;
    default:
      // "none" or "unfiltered": nothing in or near the place. No list.
      return [`Suchi's hospital list has no cancer centre in ${name} yet.`, ...pmjayFinderLines()].join("\n\n");
  }

  for (const h of shown) lines.push(renderHospitalBullet(h, geography));
  lines.push(HOSPITAL_CONFIRMATION_SENTENCE);

  return [lines.join("\n"), ...pmjayFinderLines()].join("\n\n");
}
