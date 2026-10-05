// Apply exact runtime renders; old content-addressed assets remain available.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import Database from "better-sqlite3";
const root = "data/extraction/instance/minecraft/dumps/planner";
const blocks = process.argv.includes("--blocks");
const db = new Database("data/catalogs/gtnh-2.8.4.sqlite");
await db.backup(
  "data/catalogs/gtnh-2.8.4.before-faithful" +
    (blocks ? "-blocks" : "") +
    ".sqlite",
);
const rows = JSON.parse(
  fs.readFileSync(
    root + (blocks ? "/block-icons.json" : "/repair-icons.json"),
    "utf8",
  ),
);
const report = { installed: 0, blank: 0, missing: 0, unchanged: 0, errors: [] };
const updates = [],
  byId = new Map(),
  byImage = new Map();
const find = db.prepare("SELECT image FROM Item WHERE id=?");
fs.mkdirSync("data/game-assets/gtnh-2.8.4/items", { recursive: true });
for (const [id, filename, size] of rows) {
  if (size !== (blocks ? 256 : 64))
    throw Error("Unexpected capture resolution");
  try {
    const current = find.get(id);
    if (!current) {
      report.missing++;
      continue;
    }
    const bytes = fs.readFileSync(
      path.join(root, blocks ? "../block-icons" : "../icons", filename),
    );
    const { data, info } = await sharp(bytes)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (!data.some((value, i) => i % info.channels === 3 && value > 0)) {
      report.blank++;
      continue;
    }
    const hash = createHash("sha256").update(bytes).digest("hex");
    const image = "/assets/gtnh-2.8.4/items/" + hash + ".png";
    if (current.image === image) {
      report.unchanged++;
      continue;
    }
    fs.writeFileSync("data/game-assets/" + image.slice(8), bytes);
    updates.push([image, id]);
    byId.set(id, image);
    if (current.image) byImage.set(current.image, image);
  } catch (error) {
    report.errors.push({ id, error: String(error) });
  }
}
function replace(value) {
  if (Array.isArray(value)) return value.map(replace);
  if (value && typeof value === "object") {
    const result = Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, replace(v)]),
    );
    if (result.id && byId.has(result.id) && "image" in result)
      result.image = byId.get(result.id);
    if (result.tabItemId && byId.has(result.tabItemId))
      result.tabIcon = byId.get(result.tabItemId);
    return result;
  }
  return typeof value === "string" && byImage.has(value)
    ? byImage.get(value)
    : value;
}
db.transaction(() => {
  const update = db.prepare("UPDATE Item SET image=? WHERE id=?");
  for (const values of updates) {
    update.run(...values);
    report.installed++;
  }
  for (const r of db.prepare("SELECT id,layout FROM Recipe").all()) {
    const next = JSON.stringify(replace(JSON.parse(r.layout)));
    if (next !== r.layout)
      db.prepare("UPDATE Recipe SET layout=? WHERE id=?").run(next, r.id);
  }
})();
fs.writeFileSync(
  "data/catalogs/gtnh-2.8.4.faithful" +
    (blocks ? "-blocks" : "-images") +
    "-report.json",
  JSON.stringify(report, null, 2),
);
console.log(report);
