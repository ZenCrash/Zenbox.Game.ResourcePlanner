import fs from "node:fs";
import Database from "better-sqlite3";
const root = "data/extraction/instance/minecraft/dumps/planner";
const source = JSON.parse(fs.readFileSync(root + "/discovery.json", "utf8"));
if (!source.resourcePacks?.some((name) => name.includes("Faithful")))
  throw Error("Discovery must run with Faithful active");
const db = new Database("data/catalogs/gtnh-2.8.4.sqlite");
const known = db.prepare("SELECT * FROM Item WHERE id=?");
const canonicalHandlers = JSON.parse(
  fs.readFileSync("lib/nei-handler-order.json", "utf8"),
).handlers;
const report = {
  resourcePacks: source.resourcePacks,
  containers: 0,
  missingContainers: [],
  machineRecipes: 0,
  tabRecipes: 0,
  handlers: [],
};
db.transaction(() => {
  db.exec(
    "CREATE TABLE IF NOT EXISTS RuntimeFluidContainer (filled TEXT NOT NULL, empty TEXT NOT NULL, fluid TEXT NOT NULL, liters REAL NOT NULL CHECK(liters>0), PRIMARY KEY(filled,empty,fluid,liters)); CREATE INDEX IF NOT EXISTS RuntimeFluidContainer_fluid ON RuntimeFluidContainer(fluid)",
  );
  const insert = db.prepare(
    "INSERT OR IGNORE INTO RuntimeFluidContainer VALUES (?,?,?,?)",
  );
  for (const row of source.containers) {
    if (
      row.amount > 0 &&
      known.get(row.filled?.id) &&
      known.get(row.empty?.id) &&
      known.get(row.fluid)
    ) {
      insert.run(row.filled.id, row.empty.id, row.fluid, row.amount);
      report.containers++;
    } else
      report.missingContainers.push({
        filled: row.filled?.id,
        empty: row.empty?.id,
        fluid: row.fluid,
      });
  }
  for (const handler of source.handlers) {
    const machines = [
      ...new Set(
        (handler.machines ?? []).map((i) => i.id).filter((id) => known.get(id)),
      ),
    ];
    const tab = handler.tabItem && known.get(handler.tabItem.id)?.image;
    const recipes = db
      .prepare("SELECT id,layout FROM Recipe WHERE handler=?")
      .all(handler.name ?? "");
    for (const recipe of recipes) {
      const layout = JSON.parse(recipe.layout);
      // Several mods register different handlers under the same translated name.
      // Do not let registration order replace the canonical tab with an add-on's icon.
      const canonical = canonicalHandlers[handler.name];
      const duplicates = source.handlers.filter((h) => h.name === handler.name);
      const matches =
        handler.name === "Alloy Smelter" && layout.batchLayout === "ender-alloy"
          ? handler.class.includes("enderio")
          : duplicates.length === 1 ||
            handler.id === canonical ||
            handler.class === canonical;
      if (!matches) continue;
      let changed = false;
      if (machines.length && !layout.machineIds?.length) {
        layout.machineIds = machines;
        report.machineRecipes++;
        changed = true;
      }
      if (
        tab &&
        (tab !== layout.tabIcon || layout.tabItemId !== handler.tabItem.id)
      ) {
        layout.tabIcon = tab;
        layout.tabItemId = handler.tabItem.id;
        report.tabRecipes++;
        changed = true;
      }
      if (changed)
        db.prepare("UPDATE Recipe SET layout=? WHERE id=?").run(
          JSON.stringify(layout),
          recipe.id,
        );
    }
    report.handlers.push({
      name: handler.name,
      class: handler.class,
      recipes: recipes.length,
      machines: machines.length,
      tab: !!tab,
      background: handler.background,
      width: handler.width,
      height: handler.height,
      error: handler.error ?? handler.renderError ?? handler.enumerationError,
    });
  }
})();
fs.writeFileSync(
  "data/catalogs/gtnh-2.8.4.runtime-discovery-report.json",
  JSON.stringify(report, null, 2),
);
console.log({
  containers: report.containers,
  missingContainers: report.missingContainers.length,
  machineRecipes: report.machineRecipes,
  tabRecipes: report.tabRecipes,
  handlers: report.handlers.length,
});
