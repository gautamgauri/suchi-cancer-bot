# SCCF landing site (suchitracancercare.org)

Deployed to GitHub Pages by `.github/workflows/deploy-landing.yml` on every push to
`main` that touches `apps/landing/**`.

## Analytics (GA4)

- **Where the ID goes:** `src/config/analytics.ts` → `GA_MEASUREMENT_ID`. It is empty
  by default. While it is empty the site loads no Google Analytics script, makes no
  request to Google for analytics and shows no consent notice. Use SCCF's own GA4
  property only; never share a property or ID with another organisation.
- **Consent:** with an ID set, visitors see a small notice. Nothing is loaded or sent
  until they choose "Allow analytics". Advertising storage is always denied, Google
  Signals and ad personalisation are off, and the `_ga` cookie is host-only, so it is
  never sent to `chat.suchitracancercare.org`. "Cookie preferences" in the footer
  reopens the notice to withdraw consent.
- **Custom events** (`src/components/Analytics.astro`, delegated listeners, left and
  middle clicks): `ask_suchi_click` (outbound click to the chat; the chat app itself
  is not instrumented), `outbound_social_click` (`platform`), `contact_enquiry`
  (`method: email` for mailto links to an @suchitracancercare.org address; `method:
  form` only after the API confirms a contact-form message was delivered), plus
  `volunteer_click`, `newsletter_signup` and `donate_click` for any element tagged
  `data-analytics-event="…"`.
- **What leaves the page, exactly.** Our custom events carry only `platform` or
  `method`, never page text, form values or search/filter text. Our code sets
  `page_location` and `page_referrer` to the path plus any `utm_*` tags, dropping
  other query strings such as the `/watch/?cancer=…` filters. GA4 itself always adds
  the page path and title (which name the topic, e.g. `/cancer-types/breast-cancer/`)
  and its own approximate location and device data. **Anything beyond that depends on
  the GA4 property settings below, which page code cannot override.**

### Mandatory GA4 setup, before the ID goes in

In GA4 Admin, for SCCF's own property:

1. **Data streams → (web stream) → Enhanced measurement:** keep *Page views* and
   *Scrolls*. Under *Page views → Show advanced settings*, turn **off** "Page changes
   based on browser history events". Turn **off** *Outbound clicks* (it would send
   every outbound `link_url`; our own events already cover the links that matter),
   *Site search*, *Form interactions* (it sends the form's destination URL),
   *Video engagement* and *File downloads* (it sends link text).
2. **Data streams → (web stream) → Redact data:** turn on email redaction and
   query-parameter redaction for `prompt`, `cancer` and `situation`. This is a second
   line of defence for anything that slips past step 1.
3. **Data collection:** Google Signals **off**; *Granular location and device data
   collection* **off**; ads personalisation **off**. Do not link Google Ads.
4. **Data retention:** 2 months (the minimum).

Then paste the `G-…` ID into `src/config/analytics.ts` in a PR. Check DebugView: no
hits before "Allow analytics", then only GA4's automatic events (`page_view`,
`session_start`, `first_visit`, `user_engagement`), `scroll` and the custom events
above.

Code-side defence: no outbound link on the site carries a health topic in its URL.
The watch pages' "Ask Suchi about this video" link used to append
`?prompt=<video title and cancer type>`; the chat never read it, so it was removed.
Keep it that way: don't put health topics in outbound URLs.

## Contact form

The homepage form posts to the API (`POST /v1/contact` on suchi-api;
`src/config/contact.ts`), which emails the message to the SCCF team and keeps no
copy. Who receives it is server config (`CONTACT_FORM_TO`, `CONTACT_FORM_CC` in
Secret Manager), never part of this site. Until those are set the API answers 503 and
the form shows an error with the published address, `info@suchitracancercare.org`.
The success message appears only after a 2xx. Deploy the API before relying on the
form.

## UTM convention for social posts

Tag every link to this site that you post on social media:

```
?utm_source={platform}&utm_medium=social&utm_campaign=sccf-{yyyymm}-{theme}
```

Use lowercase only, and hyphens inside the theme. Link to a page on
suchitracancercare.org, not straight to the chat, because the chat is not measured.

- `https://suchitracancercare.org/?utm_source=instagram&utm_medium=social&utm_campaign=sccf-202612-cervical-screening`
- `https://suchitracancercare.org/watch/?utm_source=youtube&utm_medium=social&utm_campaign=sccf-202612-onco-talks`
- `https://suchitracancercare.org/find-care/?utm_source=whatsapp&utm_medium=social&utm_campaign=sccf-202701-find-care`

---

# Astro Starter Kit: Minimal

```sh
npm create astro@latest -- --template minimal
```

> 🧑‍🚀 **Seasoned astronaut?** Delete this file. Have fun!

## 🚀 Project Structure

Inside of your Astro project, you'll see the following folders and files:

```text
/
├── public/
├── src/
│   └── pages/
│       └── index.astro
└── package.json
```

Astro looks for `.astro` or `.md` files in the `src/pages/` directory. Each page is exposed as a route based on its file name.

There's nothing special about `src/components/`, but that's where we like to put any Astro/React/Vue/Svelte/Preact components.

Any static assets, like images, can be placed in the `public/` directory.

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command                   | Action                                           |
| :------------------------ | :----------------------------------------------- |
| `npm install`             | Installs dependencies                            |
| `npm run dev`             | Starts local dev server at `localhost:4321`      |
| `npm run build`           | Build your production site to `./dist/`          |
| `npm run preview`         | Preview your build locally, before deploying     |
| `npm run astro ...`       | Run CLI commands like `astro add`, `astro check` |
| `npm run astro -- --help` | Get help using the Astro CLI                     |

## 👀 Want to learn more?

Feel free to check [our documentation](https://docs.astro.build) or jump into our [Discord server](https://astro.build/chat).
