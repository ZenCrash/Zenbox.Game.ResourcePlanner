import { after, test } from "node:test";
import assert from "node:assert/strict";
import { GET } from "../app/api/recipes/route";
import { catalog } from "../lib/db";
import { recipeTabIcon, type Recipe } from "../lib/model";
import { hydrateRecipeVariants } from "../lib/recipe-data";
import { containedFluids, fluidContents, fluidLookupItems, hydrateFluidContents } from "../lib/fluid-containers";
import { machineTier } from '../lib/machine-selection';
import { recipeTier } from '../lib/recipe-picker-order';

test("oil-cell reference metadata comes from the real fill/drain recipes", async () => {
  const recipe = await catalog.recipe.findFirstOrThrow({
    where: { enabled: true, ingredients: { some: { itemId: "gregtech:gt.metaitem.01:30707" } } },
    include: { ingredients: { include: { item: true } } },
  });
  const [hydrated] = await hydrateFluidContents([recipe]);
  assert(hydrated.ingredients.find((ingredient) => ingredient.itemId === "gregtech:gt.metaitem.01:30707")?.item.containedFluidIds?.includes("fluid:oil"));
  assert.equal(hydrated.ingredients.find((ingredient) => ingredient.itemId === "gregtech:gt.metaitem.01:30707")?.item.fluidContents?.find((content) => content.fluidId === "fluid:oil")?.liters, 1000);
});

after(() => catalog.$disconnect());
for (const handler of [
  "Alloy Smelter Molding",
  "Alloy Smelter Recycling",
  "Fluid Extractor Recycling",
  "Arc Furnace Recycling",
]) {
  test(`${handler} exposes its GregTech machines`, async () => {
    const base = await catalog.recipe.findFirstOrThrow({
      where: { handler },
      include: { ingredients: { include: { item: true } } },
    });
    const [recipe] = await hydrateRecipeVariants([base]);
    assert((recipe.craftingMachines?.length ?? 0) > 1);
    assert(
      recipe.craftingMachines!.every((item) => item.id.startsWith("gregtech:")),
    );
    assert(recipe.craftingMachines!.every((item) => item.image));
    const machine = recipe.craftingMachines!.find(item => !machineTier(item) || machineTier(item) === recipeTier(recipe));
    assert(machine, 'a machine supporting this recipe tier');
    const response = await GET(
      new Request(
        `http://localhost/api/recipes?mode=uses&item=${encodeURIComponent(machine.id)}`,
      ),
    );
    const found: Recipe[] = await response.json();
    assert(found.some((r) => r.id === recipe.id));
  });
}
test("Blast Furnace uses the EBF icon and includes Helioflare instead of IC2", async () => {
  const base = await catalog.recipe.findFirstOrThrow({
    where: { handler: "Blast Furnace" },
    include: { ingredients: { include: { item: true } } },
  });
  const [recipe] = await hydrateRecipeVariants([
    {
      ...base,
      layout: JSON.stringify({
        machineIds: ["IC2:blockMachine3:1", "gregtech:gt.blockmachines:12730"],
      }),
    },
  ]);
  const machines = recipe.craftingMachines ?? [];
  assert(machines.some((i) => i.id === "gregtech:gt.blockmachines:15412"));
  assert(machines.some((i) => i.id === "gregtech:gt.blockmachines:12730"));
  assert(!machines.some((i) => i.id === "IC2:blockMachine3:1"));
  assert.equal(
    recipeTabIcon(recipe),
    machines.find((i) => i.id === "gregtech:gt.blockmachines:1000")?.image,
  );
  for (const [machine, expected] of [
    ["gregtech:gt.blockmachines:15412", true],
    ["IC2:blockMachine3:1", false],
  ] as const) {
    const response = await GET(
      new Request(
        `http://localhost/api/recipes?mode=uses&item=${encodeURIComponent(machine)}`,
      ),
    );
    const found: Recipe[] = await response.json();
    assert.equal(
      found.some((r) => r.id === base.id),
      expected,
    );
  }
});
test("Casting Table recipes appear in output, fluid usage, and machine lookups", async () => {
  const response = await GET(
    new Request(
      "http://localhost/api/recipes?mode=category&item=Casting%20Table",
    ),
  );
  const recipes: Recipe[] = await response.json();
  assert(recipes.length > 0, "Casting Table registry must be imported");
  const recipe = recipes.find((r) =>
    r.ingredients.some((i) => i.direction === "input" && !i.consumed),
  );
  assert(recipe, "reusable casts retain their non-consumed status");
  const machine = recipe.craftingMachines?.find(
    (i) => i.id === "TConstruct:SearedBlock",
  );
  assert(machine?.image);
  assert.equal(recipeTabIcon(recipe), machine.image);
  const output = recipe.ingredients.find((i) => i.direction === "output")!;
  const fluid = recipe.ingredients.find(
    (i) => i.direction === "input" && i.item.kind === "fluid",
  )!;
  assert(fluid.amount > 0);
  for (const [item, mode] of [
    [output.itemId, "recipes"],
    [fluid.itemId, "uses"],
    [machine.id, "uses"],
  ]) {
    const result = await GET(
      new Request(
        `http://localhost/api/recipes?mode=${mode}&item=${encodeURIComponent(item)}`,
      ),
    );
    const found: Recipe[] = await result.json();
    assert(
      found.some((r) => r.id === recipe.id),
      `${mode} lookup for ${item}`,
    );
  }
});
test("Blasting exposes Et Futurum's Blast Furnace as machine and tab icon", async () => {
  const base = await catalog.recipe.findFirstOrThrow({
    where: { handler: "Blasting" },
    include: { ingredients: { include: { item: true } } },
  });
  const [recipe] = await hydrateRecipeVariants([{ ...base, layout: "{}" }]);
  const machine = recipe.craftingMachines?.find(
    (item) => item.id === "etfuturum:blast_furnace",
  );
  assert(machine?.image);
  assert.equal(recipeTabIcon(recipe), machine.image);
});

for (const [cell, fluid] of [
  ["gregtech:gt.metaitem.01:30013", "fluid:oxygen"],
  ["IC2:itemCellEmpty:1", "fluid:water"],
  ["gregtech:gt.metaitem.01:30707", "fluid:oil"],
]) {
  for (const mode of ["recipes", "uses"]) {
    test(`${mode} for ${cell} include both the cell and its fluid without duplicates`, async () => {
      assert((await fluidContents(cell)).includes(fluid));
      const lookup = async (item: string): Promise<Recipe[]> => {
        const response = await GET(
          new Request(
            `http://localhost/api/recipes?mode=${mode}&item=${encodeURIComponent(item)}`,
          ),
        );
        assert.equal(response.status, 200);
        return response.json();
      };
      const [cellRecipes, fluidRecipes] = await Promise.all([
        lookup(cell),
        lookup(fluid),
      ]);
      const ids = new Set(cellRecipes.map((recipe) => recipe.id));
      assert(fluidRecipes.length > 0);
      assert.deepEqual(new Set(fluidRecipes.map((recipe) => recipe.id)), ids);
      assert.equal(ids.size, cellRecipes.length);
      assert(
        cellRecipes.some((recipe) =>
          recipe.ingredients.some(
            (ingredient) =>
              ingredient.itemId === cell &&
              ingredient.direction === (mode === "uses" ? "input" : "output"),
          ),
        ),
      );
    });
  }
}

test("empty cells and multiple-fluid conversions do not broaden lookups", async () => {
  assert.deepEqual(await fluidContents("IC2:itemCellEmpty"), []);
  assert.deepEqual(await fluidContents("missing-test-item"), []);
  assert.deepEqual(await fluidLookupItems("IC2:itemCellEmpty"), ["IC2:itemCellEmpty"]);
  assert.deepEqual(await fluidLookupItems("missing-test-item"), ["missing-test-item"]);
  const ingredient = (itemId: string, direction: string, kind = "item") => ({
    itemId,
    direction,
    amount: 1,
    item: { kind },
  });
  assert.deepEqual(
    containedFluids("cell", [
      {
        ingredients: [
          ingredient("cell", "input"),
          ingredient("empty", "output"),
          ingredient("fluid:a", "output", "fluid"),
          ingredient("fluid:b", "output", "fluid"),
        ],
      },
    ]),
    [],
  );
});

test("machine uses start with processing tabs and retain ingredient uses", async () => {
  const machine = "gregtech:gt.blockmachines:651";
  const response = await GET(
    new Request(
      `http://localhost/api/recipes?mode=uses&item=${encodeURIComponent(machine)}`,
    ),
  );
  const recipes: Recipe[] = await response.json();
  // Recycling is now a supported processing category too, and its explicit
  // tab-order rank precedes the unranked main Arc Furnace category.
  assert.equal(recipes[0]?.handler, "Arc Furnace");
  assert(recipes.some((recipe) => recipe.handler === "Arc Furnace"));
  assert(recipes.some((recipe) => recipe.handler === "Arc Furnace Recycling"));
  const isProcessing = (recipe: Recipe) =>
    recipe.craftingMachines?.some((item) => item.id === machine);
  const firstIngredientTab = recipes.findIndex(
    (recipe) => !isProcessing(recipe),
  );
  assert(
    firstIngredientTab > 0,
    "fixture has both processing and ingredient uses",
  );
  assert(
    recipes.slice(firstIngredientTab).every((recipe) => !isProcessing(recipe)),
  );
  assert(
    recipes
      .slice(firstIngredientTab)
      .some((recipe) =>
        recipe.ingredients.some(
          (ingredient) =>
            ingredient.direction === "input" && ingredient.itemId === machine,
        ),
      ),
  );
  assert.equal(
    new Set(recipes.map((recipe) => recipe.id)).size,
    recipes.length,
  );
});

test("left-click machine recipes do not include its processing recipes", async () => {
  const response = await GET(
    new Request(
      "http://localhost/api/recipes?mode=recipes&item=gregtech%3Agt.blockmachines%3A651",
    ),
  );
  const recipes: Recipe[] = await response.json();
  assert(recipes.length > 0);
  assert(
    recipes.every((recipe) =>
      recipe.ingredients.some(
        (ingredient) =>
          ingredient.direction === "output" &&
          ingredient.itemId === "gregtech:gt.blockmachines:651",
      ),
    ),
  );
});

test("unknown items still return no uses", async () => {
  const response = await GET(
    new Request(
      "http://localhost/api/recipes?mode=uses&item=missing-test-item",
    ),
  );
  assert.deepEqual(await response.json(), []);
});
