/**
 * Google Analytics 4: the ONE place the measurement ID is configured.
 *
 * Paste SCCF's own GA4 web-stream ID (format `G-XXXXXXXXXX`) between the
 * quotes below and open a PR. The property must belong to SCCF alone; never
 * reuse another organisation's property or ID here.
 *
 * While this is empty (or not a valid `G-` ID), the site renders exactly as
 * before: no consent notice, no Google script, no request to Google.
 *
 * See apps/landing/README.md ("Analytics") for what is and is not collected.
 */
export const GA_MEASUREMENT_ID: string = '';

export const isAnalyticsConfigured = /^G-[A-Z0-9]{4,}$/.test(GA_MEASUREMENT_ID);
