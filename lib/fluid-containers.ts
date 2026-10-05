import { catalog } from "./db";
import type { Item, Recipe } from "./model";

export function containerFill(
  filledId: string,
  emptyIds: string[],
  ingredients: (ContainerIngredient & { item: Item })[],
) {
  if (ingredients.length !== 3 || ingredients.some((i) => i.amount <= 0))
    return;
  const fluid = ingredients.filter((i) => i.item.kind === "fluid");
  if (fluid.length !== 1) return;
  const filled = ingredients.find(
    (i) => i.itemId === filledId && i.direction !== fluid[0].direction,
  );
  const empty = ingredients.find(
    (i) => emptyIds.includes(i.itemId) && i.direction === fluid[0].direction,
  );
  if (!filled || !empty || filled.amount !== empty.amount) return;
  return { item: fluid[0].item, amount: fluid[0].amount / filled.amount };
}

export async function bottlerFluids(recipes: Recipe[]) {
  const bottlers = recipes.filter((r) => r.handler === "Bottler");
  const ids = [
    ...new Set(
      bottlers.flatMap((r) =>
        r.ingredients
          .filter((i) => i.direction === "output" && i.item.kind !== "fluid")
          .map((i) => i.itemId),
      ),
    ),
  ];
  const matches = new Map<string, (ContainerIngredient & { item: Item })[][]>();
  for (let start = 0; start < ids.length; start += 200) {
    const rows = await catalog.ingredient.findMany({
      where: {
        itemId: { in: ids.slice(start, start + 200) },
        recipe: { enabled: true, handler: "Fluid Canner" },
      },
      include: {
        recipe: { include: { ingredients: { include: { item: true } } } },
      },
    });
    for (const row of rows) {
      const candidates = matches.get(row.itemId) ?? [];
      candidates.push(row.recipe.ingredients);
      matches.set(row.itemId, candidates);
    }
  }
  const result = new Map<string, { item: Item; amount: number }>();
  for (const recipe of bottlers) {
    const emptyIds = recipe.ingredients
      .filter((i) => i.direction === "input" && i.item.kind !== "fluid")
      .map((i) => i.itemId);
    for (const output of recipe.ingredients.filter(
      (i) => i.direction === "output" && i.item.kind !== "fluid",
    )) {
      const fills = (matches.get(output.itemId) ?? []).flatMap(
        (ingredients) => {
          const fill = containerFill(output.itemId, emptyIds, ingredients);
          return fill ? [fill] : [];
        },
      );
      if (
        fills.length &&
        fills.every(
          (fill) =>
            fill.item.id === fills[0].item.id &&
            fill.amount === fills[0].amount,
        )
      ) {
        result.set(recipe.id, {
          item: fills[0].item,
          amount: fills[0].amount * output.amount,
        });
      }
    }
  }
  return result;
}

type ContainerIngredient = {
  itemId: string;
  direction: string;
  amount: number;
  item: { kind: string };
};

// Only a pure fill/drain operation establishes contents. Chemical reactions,
// empty containers, and recipes with multiple fluids must not create aliases.
export function containedFluids(
  itemId: string,
  recipes: { ingredients: ContainerIngredient[] }[],
) {
  return [
    ...new Set(
      containerRelations(recipes)
        .filter((pair) => pair.filled === itemId)
        .map((pair) => pair.fluid),
    ),
  ];
}

function containerRelations(recipes: { ingredients: ContainerIngredient[] }[]) {
  const pairs: { filled: string; empty: string; fluid: string; liters: number }[] = [];
  for (const { ingredients } of recipes) {
    if (ingredients.length !== 3 || ingredients.some((i) => i.amount <= 0))
      continue;
    const fluid = ingredients.filter((i) => i.item.kind === "fluid");
    const items = ingredients.filter((i) => i.item.kind !== "fluid");
    if (fluid.length !== 1 || items.length !== 2) continue;
    const filled = items.find(
      (i) => i.direction !== fluid[0].direction,
    );
    const empty = items.find(
      (i) => i.direction === fluid[0].direction,
    );
    if (
      filled && empty &&
      filled.itemId !== empty.itemId && filled.amount === empty.amount
    )
      pairs.push({ filled: filled.itemId, empty: empty.itemId, fluid: fluid[0].itemId, liters: fluid[0].amount / filled.amount });
  }
  return pairs;
}

async function containerRecipes(itemIds: string[]) {
  const recipes = await catalog.recipe.findMany({
    where: {
      enabled: true,
      handler: "Fluid Canner",
      ingredients: { some: { itemId: { in: itemIds } } },
    },
    select: {
      ingredients: {
        select: {
          itemId: true,
          direction: true,
          amount: true,
          item: { select: { kind: true } },
        },
      },
    },
  });
  // The game registry also covers buckets/capsules which have no Fluid Canner
  // recipe. Keep these as lookup relationships, not invented crafting recipes.
  const tables = await catalog.$queryRawUnsafe<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='RuntimeFluidContainer'",
  );
  if (!tables.length || !itemIds.length) return recipes;
  const placeholders = itemIds.map(() => '?').join(',');
  const links = await catalog.$queryRawUnsafe<{ filled: string; empty: string; fluid: string; liters: number }[]>(
    `SELECT filled, empty, fluid, liters FROM RuntimeFluidContainer WHERE filled IN (${placeholders}) OR fluid IN (${placeholders})`,
    ...itemIds, ...itemIds,
  );
  return [...recipes, ...links.map(link => ({ ingredients: [
    { itemId: link.empty, direction: 'input', amount: 1, item: { kind: 'item' } },
    { itemId: link.fluid, direction: 'input', amount: link.liters, item: { kind: 'fluid' } },
    { itemId: link.filled, direction: 'output', amount: 1, item: { kind: 'item' } },
  ] }))];
}

export async function fluidContents(itemId: string) {
  return containedFluids(itemId, await containerRecipes([itemId]));
}

export async function emptyFluidContainers(itemIds: string[]) {
  const ids = new Set<string>();
  for (let start = 0; start < itemIds.length; start += 200) {
    for (const pair of containerRelations(await containerRecipes(itemIds.slice(start, start + 200)))) ids.add(pair.empty);
  }
  return [...ids];
}

export async function hydrateFluidContents(recipes: Recipe[]): Promise<Recipe[]> {
  const ids = [...new Set(recipes.flatMap((recipe) => recipe.ingredients.flatMap((ingredient) =>
    [ingredient.item, ...(ingredient.alternativeItems ?? [])].filter((item) => item.kind !== "fluid").map((item) => item.id),
  )))];
  const contents = new Map<string, Map<string, Set<number>>>();
  for (let start = 0; start < ids.length; start += 200) {
    for (const pair of containerRelations(await containerRecipes(ids.slice(start, start + 200)))) {
      const fluids = contents.get(pair.filled) ?? new Map<string, Set<number>>();
      const amounts = fluids.get(pair.fluid) ?? new Set<number>();
      amounts.add(pair.liters);
      fluids.set(pair.fluid, amounts);
      contents.set(pair.filled, fluids);
    }
  }
  const hydrate = (item: Item): Item => ({
    ...item,
    containedFluidIds: [...(contents.get(item.id)?.keys() ?? [])],
    fluidContents: [...(contents.get(item.id) ?? [])].flatMap(([fluidId, amounts]) =>
      amounts.size === 1 ? [{ fluidId, liters: [...amounts][0] }] : [],
    ),
  });
  return recipes.map((recipe) => ({ ...recipe, ingredients: recipe.ingredients.map((ingredient) => ({
    ...ingredient, item: hydrate(ingredient.item), alternativeItems: ingredient.alternativeItems?.map(hydrate),
  })) }));
}

// Browse the same fluid and filled-container recipes from either form. Empty
// containers never establish a link, and similarly named fluids stay separate.
export async function fluidLookupItems(itemId: string) {
  const pairs = containerRelations(await containerRecipes([itemId]));
  const fluids = [
    ...new Set(
      pairs
        .filter((pair) => pair.filled === itemId || pair.fluid === itemId)
        .map((pair) => pair.fluid),
    ),
  ];
  if (!fluids.length) return [itemId];
  const related = containerRelations(await containerRecipes(fluids));
  return [
    ...new Set([
      itemId,
      ...fluids,
      ...related
        .filter((pair) => fluids.includes(pair.fluid))
        .map((pair) => pair.filled),
    ]),
  ];
}

// A unit in the selected form expressed in each related form. Ambiguous
// contents/capacities must not invent a conversion rate for planner scoring.
export async function fluidLookupAmounts(itemId: string): Promise<Record<string, number>> {
  const first = containerRelations(await containerRecipes([itemId]));
  const fluidIds = [...new Set(first.filter((pair) => pair.filled === itemId || pair.fluid === itemId).map((pair) => pair.fluid))];
  if (fluidIds.length !== 1) return { [itemId]: 1 };
  const fluidId = fluidIds[0];
  const related = containerRelations(await containerRecipes([fluidId]));
  const candidateIds = [...new Set(related.map((pair) => pair.filled))];
  const ambiguous = new Set<string>();
  for (let start = 0; start < candidateIds.length; start += 200) {
    for (const pair of containerRelations(await containerRecipes(candidateIds.slice(start, start + 200)))) {
      if (pair.fluid !== fluidId) ambiguous.add(pair.filled);
    }
  }
  const capacities = new Map<string, Set<number>>([[fluidId, new Set([1])]]);
  for (const pair of related) {
    const values = capacities.get(pair.filled) ?? new Set<number>();
    values.add(pair.liters); capacities.set(pair.filled, values);
  }
  const selected = capacities.get(itemId);
  if (selected?.size !== 1) return { [itemId]: 1 };
  const liters = [...selected][0];
  const result: Record<string, number> = { [itemId]: 1 };
  for (const [id, values] of capacities) {
    if (values.size !== 1 || ambiguous.has(id)) continue;
    const capacity = [...values][0];
    if (Number.isFinite(capacity) && capacity > 0 && Number.isFinite(liters) && liters > 0) result[id] = liters / capacity;
  }
  return result;
}
