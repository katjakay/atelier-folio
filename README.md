# Atelier Folio

Static site published from a Notion database. Notion is the single source of truth;
nothing is edited here by hand.

```
build.mjs                    queries Notion, mirrors images, writes docs/data.json
docs/index.html              the site (loads data.json at runtime)
docs/data.json               generated — do not edit
docs/images/                 generated — mirrored product images
.github/workflows/build.yml  runs the build on a schedule / on demand / on webhook
```

## Setup

1. **Notion integration** — notion.so/profile/integrations → New integration (internal,
   read access is enough). Copy the secret. Then open the Fashion Orders database →
   `···` → Connections → connect the integration. Skipping this returns empty results.

2. **Repo secrets** — Settings → Secrets and variables → Actions:

   | Secret | Value |
   |---|---|
   | `NOTION_TOKEN` | the `ntn_…` integration secret |
   | `NOTION_DATA_SOURCE_ID` | `aef0e30d-3f5e-417a-9cc8-530f77a67593` |

3. **Pages** — Settings → Pages → Deploy from a branch → `main` / `/docs`.

4. **First run** — Actions → Build wardrobe → Run workflow.

## How it refreshes

- every 6 hours on a cron
- whenever you press **Run workflow**
- whenever `build.mjs` or `docs/index.html` is pushed
- on a `notion-updated` repository_dispatch event, if you wire the Notion webhook below

### Optional: publish immediately on a Notion edit

Create a fine-grained GitHub token with `Contents: read and write` on this repo, then add
a Notion database automation — *When any property is edited → Send webhook*:

```
POST https://api.github.com/repos/<user>/<repo>/dispatches
Authorization: Bearer <github-token>
Accept: application/vnd.github+json

{"event_type": "notion-updated"}
```

## Schema expectations

`build.mjs` reads these properties by name: `Name` (title), `Brand` (select),
`Category` (multi-select), `Colour`, `Size`, `Price` (text), `Retailer` (select),
`Acquired` (date), `Source` (select), `Image` (url). Renaming a property in Notion means renaming it in
`toItem()` too — the build will otherwise emit blank fields rather than failing loudly.

## Images

Product images are downloaded into `docs/images/` and referenced locally, so the archive
survives retailer CDNs expiring their links. Files are named by a hash of the source URL,
so re-runs skip anything already mirrored. If a download fails the build keeps the remote
URL and logs a warning rather than aborting.
