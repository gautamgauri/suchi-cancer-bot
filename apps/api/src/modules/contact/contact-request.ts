import type { CorsOptions, CorsOptionsDelegate } from "@nestjs/common/interfaces/external/cors-options.interface";
import type { Request } from "express";

/** The public site that hosts the contact form. Not secret: it is the site's own domain. */
export const CONTACT_PRODUCTION_ORIGINS = [
  "https://suchitracancercare.org",
  "https://www.suchitracancercare.org",
] as const;

/** Astro dev/preview servers, allowed only outside production. */
const CONTACT_DEV_ORIGINS = ["http://localhost:4321", "http://127.0.0.1:4321"] as const;

export const CONTACT_PATH = "/v1/contact";

export function contactAllowedOrigins(nodeEnv = process.env.NODE_ENV): string[] {
  return nodeEnv === "production"
    ? [...CONTACT_PRODUCTION_ORIGINS]
    : [...CONTACT_PRODUCTION_ORIGINS, ...CONTACT_DEV_ORIGINS];
}

export function isContactOriginAllowed(origin: string | undefined, nodeEnv = process.env.NODE_ENV): boolean {
  return !!origin && contactAllowedOrigins(nodeEnv).includes(origin);
}

function isContactPath(url: string | undefined): boolean {
  const path = (url ?? "").split("?")[0].replace(/\/+$/, "");
  return path === CONTACT_PATH;
}

/**
 * App-wide CORS. Every route keeps the previous `cors: true` behaviour (the
 * `cors` package defaults: any origin). Only /v1/contact is restricted to the
 * landing site's origins and to POST.
 */
export const corsOptionsDelegate: CorsOptionsDelegate<Request> = (req, callback) => {
  if (isContactPath(req.originalUrl ?? req.url)) {
    const options: CorsOptions = {
      origin: contactAllowedOrigins(),
      methods: ["POST"],
      allowedHeaders: ["Content-Type"],
      maxAge: 600,
    };
    callback(null, options);
    return;
  }
  callback(null, {});
};

/**
 * Client IP for rate limiting. Cloud Run's front end appends the address it
 * saw to X-Forwarded-For, so the right-most entry is the one a client cannot
 * forge (left-most entries are whatever the client sent). Falls back to the
 * socket address when the header is absent (local runs, tests).
 */
export function contactClientIp(req: Pick<Request, "headers" | "ip" | "socket">): string {
  const header = req.headers["x-forwarded-for"];
  const raw = Array.isArray(header) ? header.join(",") : header;
  if (raw) {
    const hops = raw.split(",").map((h) => h.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}
