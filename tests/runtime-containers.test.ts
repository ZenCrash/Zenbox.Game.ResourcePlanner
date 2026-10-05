import { after, test } from "node:test";
import assert from "node:assert/strict";
import { catalog } from "../lib/db";
import { fluidLookupItems, fluidLookupAmounts } from "../lib/fluid-containers";
after(() => catalog.$disconnect());

test("shared display names retain canonical crafting and distinct alloy tab icons", async () => {
  for (const handler of ["Shaped Crafting", "Shapeless Crafting"]) {
    const recipe = await catalog.recipe.findFirstOrThrow({
      where: { handler },
    });
    assert.equal(
      JSON.parse(recipe.layout).tabItemId,
      "minecraft:crafting_table",
    );
  }
  const recipes = await catalog.recipe.findMany({
    where: { handler: "Alloy Smelter" },
  });
  const ender = recipes.find(
    (r) => JSON.parse(r.layout).batchLayout === "ender-alloy",
  )!;
  const gregtech = recipes.find((r) => JSON.parse(r.layout).slotCounts)!;
  assert.equal(JSON.parse(ender.layout).tabItemId, "EnderIO:blockAlloySmelter");
  assert.notEqual(
    JSON.parse(ender.layout).tabIcon,
    JSON.parse(gregtech.layout).tabIcon,
  );
});

test("registered containers without canner recipes browse both forms and retain capacity", async () => {
  const cell = "miscutils:itemCellNeon",
    fluid = "fluid:neon";
  assert.equal(
    await catalog.recipe.count({
      where: {
        handler: "Fluid Canner",
        ingredients: { some: { itemId: cell } },
      },
    }),
    0,
  );
  const fromCell = await fluidLookupItems(cell),
    fromFluid = await fluidLookupItems(fluid);
  assert(fromCell.includes(fluid));
  assert(fromFluid.includes(cell));
  assert.deepEqual(new Set(fromCell), new Set(fromFluid));
  assert.equal((await fluidLookupAmounts(cell))[fluid], 1000);
  assert.equal((await fluidLookupAmounts(fluid))[cell], 0.001);
});

test("empty containers never link unrelated fluids", async () => {
  assert.deepEqual(await fluidLookupItems("IC2:itemCellEmpty"), [
    "IC2:itemCellEmpty",
  ]);
  assert(
    !(await fluidLookupItems("miscutils:itemCellNeon")).includes("fluid:xenon"),
  );
});
