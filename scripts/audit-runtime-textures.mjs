// Inventory Faithful's native resolution and extract NEI's registered tab sprites.
import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import sharp from "sharp";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
const game =
  process.argv[2] ??
  "C:/Users/jacob/AppData/Roaming/PrismLauncher/instances/GT New Horizons/minecraft";
const packName = "GTNH-Faithful-x32.v2.1.4.zip";
const pack = new AdmZip(path.join(game, "resourcepacks", packName));
const inventory = [];
for (const entry of pack
  .getEntries()
  .filter((e) => e.entryName.endsWith(".png"))) {
  const bytes = pack.readFile(entry);
  if (bytes?.readUInt32BE(0) === 0x89504e47)
    inventory.push({
      path: entry.entryName,
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
    });
}
fs.mkdirSync("data/research/runtime-discovery", { recursive: true });
fs.writeFileSync(
  "data/research/runtime-discovery/faithful-textures.json",
  JSON.stringify({ pack: packName, textures: inventory }, null, 2),
);
const discovery = JSON.parse(
  fs.readFileSync(
    "data/extraction/instance/minecraft/dumps/planner/discovery.json",
  ),
);
const requested = new Set(
  discovery.handlers.flatMap((h) =>
    h.tabImage
      ? [
          `assets/${h.tabImage.resourceLocation.field_110626_a}/${h.tabImage.resourceLocation.field_110625_b}`,
        ]
      : [],
  ),
);
const textures = new Map();
for (const file of requested)
  if (pack.getEntry(file))
    textures.set(file, { bytes: pack.readFile(file), archive: packName });
for (const jar of fs
  .readdirSync(game + "/mods")
  .filter((f) => f.endsWith(".jar"))) {
  if (textures.size === requested.size) break;
  const zip = new AdmZip(game + "/mods/" + jar);
  for (const file of requested)
    if (!textures.has(file) && zip.getEntry(file))
      textures.set(file, { bytes: zip.readFile(file), archive: jar });
}
const db = new Database("data/catalogs/gtnh-2.8.4.sqlite"),
  report = [];
for (const handler of discovery.handlers) {
  const image = handler.tabImage;
  if (!image) continue;
  const file = `assets/${image.resourceLocation.field_110626_a}/${image.resourceLocation.field_110625_b}`;
  const source = textures.get(file);
  if (!source) {
    report.push({ handler: handler.name, error: "Texture missing", file });
    continue;
  }
  const meta = await sharp(source.bytes).metadata();
  const sx = meta.width / image.textureWidth,
    sy = meta.height / image.textureHeight;
  const rect = {
    left: Math.round(image.x * sx),
    top: Math.round(image.y * sy),
    width: Math.round(image.width * sx),
    height: Math.round(image.height * sy),
  };
  const bytes = await sharp(source.bytes).extract(rect).png().toBuffer();
  const filename = createHash("sha256").update(bytes).digest("hex") + ".png";
  fs.writeFileSync("data/game-assets/gtnh-2.8.4/items/" + filename, bytes);
  const url = "/assets/gtnh-2.8.4/items/" + filename;
  const rows = db
    .prepare("SELECT id,layout FROM Recipe WHERE handler=?")
    .all(handler.name);
  db.transaction(() => {
    for (const row of rows) {
      const layout = JSON.parse(row.layout);
      layout.tabIcon = url;
      db.prepare("UPDATE Recipe SET layout=? WHERE id=?").run(
        JSON.stringify(layout),
        row.id,
      );
    }
  })();
  report.push({
    handler: handler.name,
    archive: source.archive,
    file,
    rect,
    recipes: rows.length,
  });
}
fs.writeFileSync(
  "data/research/runtime-discovery/tab-sprites.json",
  JSON.stringify(report, null, 2),
);
console.log({ faithfulTextures: inventory.length, tabSprites: report });
