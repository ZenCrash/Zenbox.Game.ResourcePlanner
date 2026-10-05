// Prepare only the isolated extraction copy. The user's playable instance is read-only.
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
const mode = process.argv[2] ?? "discovery";
if (!["discovery", "images", "blocks", "both", "coverage", "coverage-repairs"].includes(mode))
  throw Error(
    "Usage: node scripts/prepare-runtime-discovery.mjs [discovery|images|blocks|both|coverage] [source minecraft directory]",
  );
const source =
  process.argv[3] ??
  "C:/Users/jacob/AppData/Roaming/PrismLauncher/instances/GT New Horizons/minecraft";
const game = path.resolve("data/extraction/instance/minecraft");
if (
  !fs.existsSync(game + "/planner-export.enabled") ||
  !fs.existsSync(game + "/mods")
)
  throw Error("Prepare the isolated extraction instance first");
const pack = "GTNH-Faithful-x32.v2.1.4.zip";
fs.mkdirSync(game + "/resourcepacks", { recursive: true });
fs.copyFileSync(
  path.join(source, "resourcepacks", pack),
  game + "/resourcepacks/" + pack,
);
const options = game + "/options.txt";
let settings = fs.existsSync(options) ? fs.readFileSync(options, "utf8") : "";
settings = settings.replace(/^resourcePacks:.*\r?\n?/m, "");
fs.writeFileSync(
  options,
  settings + "\nresourcePacks:" + JSON.stringify([pack]) + "\n",
);
const flags = [
  "coverage",
  "coverage-repairs",
  "coverage-targets.json",
  "discovery",
  "faithful-icons",
  "batch-layouts",
  "ores-only",
  "material-icons.json",
  "more-layouts",
  "layouts-only",
  "alchemy-only",
  "infernal-only",
  "casting-only",
  "block-images.json",
  "image-repairs.json",
  "fluids-only",
  "tooltips-only",
  "visibility-only",
  "thaum-only",
];
for (const flag of flags) {
  const file = game + "/planner-export." + flag;
  if (fs.existsSync(file))
    fs.renameSync(file, file + ".previous-" + Date.now());
}
if (mode === "coverage") fs.writeFileSync(game + "/planner-export.coverage", "Native information pages, lookup aliases and complete handler audit");
if (mode === "coverage-repairs") fs.writeFileSync(game + "/planner-export.coverage-repairs", "Verify handler registries and GUI-dependent foreground captures");
if (mode === "discovery" || mode === "both")
  fs.writeFileSync(
    game + "/planner-export.discovery",
    "Runtime metadata and layout reference capture",
  );
if (["images", "blocks", "both"].includes(mode)) {
  const db = new Database("data/catalogs/gtnh-2.8.4.sqlite", {
    readonly: true,
  });
  const requests = db
    .prepare(
      "SELECT id,registryId,metadata,nbt,image FROM Item WHERE kind='item' AND metadata<>32767",
    )
    .all()
    .filter((item) => {
      try {
        const bytes = fs.readFileSync(
          "data/game-assets/" + item.image.slice(8),
        );
        return mode === "blocks"
          ? bytes.readUInt32BE(16) >= 256
          : bytes.readUInt32BE(16) < 64;
      } catch {
        return true;
      }
    });
  fs.writeFileSync(
    game +
      (mode === "blocks"
        ? "/planner-export.block-images.json"
        : "/planner-export.image-repairs.json"),
    JSON.stringify(requests),
  );
  fs.writeFileSync(
    game + "/planner-export.faithful-icons",
    "Faithful 64px exact item renders",
  );
  console.log("Requested item renders:", requests.length);
}
console.log("Prepared", mode, "in", game);
