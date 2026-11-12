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
- **Events** (`src/components/Analytics.astro`, delegated listeners):
  `ask_suchi_click` (outbound click to the chat; the chat app itself is not
  instrumented), `outbound_social_click` (`platform`), `contact_enquiry` (`method`:
  `email` or `form`), plus `volunteer_click`, `newsletter_signup` and `donate_click`
  for any element tagged `data-analytics-event="…"`. Only `platform` and `method` are
  sent. Never page text, form values or search/filter text, and query strings are
  stripped from page URLs except `utm_*`.

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
