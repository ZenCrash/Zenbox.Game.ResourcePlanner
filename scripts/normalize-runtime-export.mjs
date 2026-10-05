import { readFile, writeFile, mkdir, copyFile, access } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { recipePowerDetails } from "./recipe-power.mjs";
import { recipeRequirementDetails } from "./recipe-requirements.mjs";

// Developer-only converter. Raw exports are retained for handler-specific fidelity work.
const root = path.resolve("data/extraction/instance/minecraft/dumps");
const read = async (name) =>
  JSON.parse(await readFile(path.join(root, "planner", name), "utf8"));
const rawItems = await read("items.json");
const tabIcons = JSON.parse(
  await readFile(
    "data/catalogs/gtnh-2.8.4.recipe-tab-icons.json",
    "utf8",
  ).catch((error) => {
    if (error.code === "ENOENT") return '{"icons":{}}';
    throw error;
  }),
).icons;
const repairedIcons = new Map(
  (
    await read("repair-icons.json").catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    })
  ).map(([id, filename]) => [id, filename]),
);
const handlers = await read("recipes.json");
const { maps: recipeSlots } = JSON.parse(
  await readFile("data/catalogs/gtnh-2.8.4.recipe-slots.json", "utf8"),
);
const visible = new Map(
  (await read("visible-items.json")).map((id, i) => [id, i]),
);
const assetDir = path.resolve("data/game-assets/gtnh-2.8.4/items");
await mkdir(assetDir, { recursive: true });
const hash = (value) => createHash("sha256").update(value).digest("hex");
const items = new Map();
let missingIcons = 0;
for (const raw of rawItems) {
  const match = raw.key.match(/^(.*):(-?\d+)$/);
  const registryId = match ? match[1] : raw.key;
  const mod = registryId.split(":")[0];
  let image = null;
  const icon = repairedIcons.get(raw.id) ?? raw.icon;
  if (icon && path.basename(icon) === icon) {
    const source = path.join(root, "icons", icon);
    try {
      await access(source);
      const filename = hash(raw.id) + ".png";
      await copyFile(source, path.join(assetDir, filename));
      image = "/assets/gtnh-2.8.4/items/" + filename;
    } catch {
      missingIcons++;
    }
  } else missingIcons++;
  items.set(raw.id, {
    id: raw.id,
    registryId,
    metadata: match ? Number(match[2]) : 0,
    nbt: raw.nbt ?? "",
    name: raw.name || raw.key,
    mod,
    group: mod,
    tooltip: String(raw.tooltip ?? "").split("<br>"),
    image,
    hidden: !visible.has(raw.id),
    sortOrder: visible.get(raw.id) ?? visible.size + items.size,
    kind: "item",
  });
}
const recipes = new Map();
const issues = [];
for (const handler of handlers) {
  if (handler.error)
    issues.push({ handler: handler.name, error: handler.error });
  for (const raw of handler.recipes) {
    const ingredients = [];
    let incomplete = false;
    for (const direction of ["input", "output"]) {
      const slots = [...(raw[direction + "s"] ?? [])];
      // Witching Gadgets uses NEI's other stacks for the bonus output.
      // Without Arcane Bellows the furnace rolls a one-in-four bonus.
      if (handler.name === "Infernal Blast Furnace" && direction === "output")
        slots.push(...(raw.other ?? []).map((i) => ({ ...i, chance: 2500 })));
      for (const ingredient of slots) {
        if (!items.has(ingredient.id)) {
          incomplete = true;
          break;
        }
        const alternatives = [
          ...new Set((ingredient.alternatives ?? []).map((a) => a.id)),
        ];
        if (alternatives.some((id) => !items.has(id))) {
          incomplete = true;
          break;
        }
        ingredients.push({
          itemId: ingredient.id,
          direction,
          amount: ingredient.amount,
          chance: (ingredient.chance ?? 10000) / 10000,
          consumed: ingredient.amount !== 0,
          slot: ingredients.filter((i) => i.direction === direction).length,
          x: ingredient.x ?? null,
          y: ingredient.y ?? null,
          alternatives,
        });
      }
      for (const fluid of raw[
        direction === "input" ? "fluidInputs" : "fluidOutputs"
      ] ?? []) {
        if (!items.has(fluid.id))
          items.set(fluid.id, {
            id: fluid.id,
            registryId: fluid.id,
            metadata: 0,
            nbt: "",
            name: fluid.name,
            mod: "Fluids",
            group: "Fluids",
            tooltip: [fluid.name],
            image: null,
            hidden: true,
            sortOrder: visible.size + items.size,
            kind: "fluid",
          });
        ingredients.push({
          itemId: fluid.id,
          direction,
          amount: fluid.amount,
          chance: 1,
          consumed: fluid.amount !== 0,
          slot: ingredients.filter((i) => i.direction === direction).length,
          x: null,
          y: null,
          alternatives: [],
        });
      }
    }
    if (incomplete || !ingredients.length) {
      issues.push({
        handler: handler.name,
        error: "Recipe omitted: missing stack identity or no ingredients",
      });
      continue;
    }
    const id = hash(JSON.stringify([handler.source, handler.name, raw]));
    recipes.set(id, {
      id,
      name: handler.name,
      handler: handler.name,
      durationTicks: raw.durationTicks ?? 0,
      euPerTick: raw.euPerTick ?? 0,
      enabled: handler.name !== "Circuit Assembly Line Imprinting" && raw.enabled !== false && raw.hidden !== true,
      layout: {
        ...(handler.kind === "gregtech" &&
        (handler.slotCounts ?? recipeSlots[handler.overlay])
          ? { slotCounts: handler.slotCounts ?? recipeSlots[handler.overlay] }
          : {}),
        ...(handler.kind === "nei" ? { width: 166, height: 80 } : {}),
        ...(tabIcons[handler.name]
          ? { tabIcon: tabIcons[handler.name].image }
          : {}),
      },
      details: [
        ...recipePowerDetails(handler, raw),
        ...recipeRequirementDetails(raw.specialValue),
        ...(raw.other?.length && handler.name !== "Infernal Blast Furnace"
          ? [
              "Additional handler slots require classification; see extraction report.",
            ]
          : []),
      ],
      ingredients,
    });
  }
}
const output = {
  game: "gtnh",
  version: "2.8.4",
  source:
    "Runtime extraction from GTNH 2.8.4 copy; NEI 2.8.44-GTNH / GregTech 5.09.51.482",
  completeness: "partial",
  items: [...items.values()],
  recipes: [...recipes.values()],
};
await writeFile(
  "data/extraction/catalog.normalized.json",
  JSON.stringify(output),
);
await writeFile(
  "data/extraction/normalization-report.json",
  JSON.stringify(
    {
      items: items.size,
      visible: visible.size,
      recipes: recipes.size,
      missingIcons,
      issues,
      limitations: [
        "Fluid icons pending",
        "Handler-specific semantics and layouts pending",
        "NEI group definitions pending",
        "Parity has not been verified",
      ],
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    items: items.size,
    recipes: recipes.size,
    missingIcons,
    issues: issues.length,
  }),
);
