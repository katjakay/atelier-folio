/**
 * Reads the Wardrobe data source from Notion and writes docs/data.json,
 * mirroring every product image into docs/images/ so the archive keeps working
 * after retailer CDN links rot.
 *
 * Env: NOTION_TOKEN, NOTION_DATA_SOURCE_ID
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const TOKEN = process.env.NOTION_TOKEN;
const DATA_SOURCE_ID = process.env.NOTION_DATA_SOURCE_ID;
const NOTION_VERSION = "2025-09-03";

const OUT_DIR = "docs";
const IMG_DIR = path.join(OUT_DIR, "images");

if (!TOKEN || !DATA_SOURCE_ID) {
  console.error("Missing NOTION_TOKEN or NOTION_DATA_SOURCE_ID.");
  process.exit(1);
}

/* ---------- Notion ---------- */

async function queryAll() {
  const rows = [];
  let cursor;
  do {
    const res = await fetch(
      `https://api.notion.com/v1/data_sources/${DATA_SOURCE_ID}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          page_size: 100,
          start_cursor: cursor,
        }),
      }
    );

    if (!res.ok) {
      throw new Error(`Notion API ${res.status}: ${await res.text()}`);
    }

    const json = await res.json();
    rows.push(...json.results);
    cursor = json.has_more ? json.next_cursor : undefined;
  } while (cursor);

  return rows;
}

/* ---------- property readers ---------- */

const plain = (p) =>
  !p ? "" : (p.title ?? p.rich_text ?? []).map((t) => t.plain_text).join("").trim();
const select = (p) => p?.select?.name ?? "";
const multi = (p) => (p?.multi_select ?? []).map((o) => o.name);
const url = (p) => p?.url ?? "";
const file = (p) => {
  const f = (p?.files ?? [])[0];
  return f?.file?.url ?? f?.external?.url ?? "";
};
const num = (p) => (typeof p?.number === "number" ? p.number : null);

function toItem(page) {
  const p = page.properties;
  return {
    id: page.id,
    name: plain(p["Name"]),
    brand: select(p["Brand"]),
    categories: multi(p["Category"]),
    color: plain(p["Colour"]),
    size: plain(p["Size"]),
    price: plain(p["Price"]),
    seasons: multi(p["Season"]),
    formality: select(p["Formality"]),
    era: select(p["Era"]),
    worn: num(p["Worn"]),
    image: url(p["Image"]),
    photo: file(p["Photo"]),
  };
}

/* ---------- image mirroring ---------- */

async function mirrorImage(remote, cacheKey) {
  if (!remote) return "";

  // Notion-hosted files come back as signed URLs that change on every query,
  // so hash a stable key instead — otherwise every run re-downloads the file.
  const hash = crypto.createHash("sha1").update(cacheKey || remote).digest("hex").slice(0, 16);
  const ext = (path.extname(new URL(remote).pathname) || ".jpg")
    .split("?")[0]
    .toLowerCase();
  const file = `${hash}${ext}`;
  const dest = path.join(IMG_DIR, file);
  const rel = `images/${file}`;

  // already mirrored on a previous run
  try {
    await fs.access(dest);
    return rel;
  } catch {}

  try {
    const res = await fetch(remote, {
      headers: {
        // some retailer CDNs reject requests without a browser-ish UA
        "User-Agent":
          "Mozilla/5.0 (compatible; wardrobe-archive/1.0; +https://github.com)",
        Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
    console.log(`  mirrored ${file}`);
    return rel;
  } catch (err) {
    console.warn(`  ! could not mirror ${remote} (${err.message}) — using remote URL`);
    return remote;
  }
}

/* ---------- main ---------- */

const pages = await queryAll();
console.log(`Fetched ${pages.length} rows from Notion.`);

await fs.mkdir(IMG_DIR, { recursive: true });

const items = [];
for (const page of pages) {
  const item = toItem(page);

  // Image (retailer URL) wins; own Photo is the fallback.
  if (item.image) {
    item.image = await mirrorImage(item.image, item.image);
  } else if (item.photo) {
    item.image = await mirrorImage(item.photo, `notion:${page.id}`);
    item.own_photo = true;
  }
  delete item.photo;

  items.push(item);
}

const payload = {
  generated_at: new Date().toISOString(),
  count: items.length,
  brands: new Set(items.map((i) => i.brand).filter(Boolean)).size,
  items,
};

await fs.writeFile(
  path.join(OUT_DIR, "data.json"),
  JSON.stringify(payload, null, 2) + "\n"
);

console.log(`Wrote ${OUT_DIR}/data.json — ${items.length} pieces, ${payload.brands} brands.`);
