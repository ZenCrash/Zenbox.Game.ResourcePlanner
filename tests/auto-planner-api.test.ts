import { after, test } from "node:test";
import assert from "node:assert/strict";
import { GET, POST } from "../app/api/auto-planner/route";
import { catalog } from "../lib/db";
import type { PlannerResult } from "../lib/auto-planner";
import { plannerComparisonSummary } from '../lib/planner-balance';
import { readPlannerResultStream } from '../lib/planner-result-stream';
import {
  fluidLookupAmounts,
  emptyFluidContainers,
} from "../lib/fluid-containers";
import { plannerRecipes } from "../lib/planner-catalog";
const request = (body: unknown) =>
  new Request("http://localhost/api/auto-planner", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const options = {
  targetId: "minecraft:cobblestone",
  inputId: "minecraft:stone",
  priority: "eu",
  allowMultiblocks: false,
  maxTier: 1,
  maxSteps: 1,
  maxSuggestions: 3,
};
after(() => catalog.$disconnect());
test('planner streams valid suggestions before completing', async () => {
  const req = request({ ...options, maxSuggestions: 1 });
  req.headers.set('Accept', 'application/x-ndjson');
  const response = await POST(req);
  assert.equal(response.headers.get('content-type'), 'application/x-ndjson');
  const counts: number[] = [];
  const result = await readPlannerResultStream(response, progress => counts.push(progress.plans.length));
  assert(counts.some(count => count > 0));
  assert.equal(result.plans.length, 1);
});
test('EV seed oil to cetane-boosted diesel resolves tetranitromethane and ethanol bans', async () => {
  const bannedNeededItemIds = ['fluid:tetranitromethane', 'gregtech:gt.metaitem.01:30639', 'fluid:bioethanol', 'gregtech:gt.metaitem.01:30706'];
  const response = await POST(request({ ...options, inputId: 'fluid:seedoil', targetId: 'fluid:nitrofuel', allowMultiblocks: true, maxTier: 4, maxSteps: 10, maxSuggestions: 10, bannedNeededItemIds }));
  assert.equal(response.status, 200);
  const result: PlannerResult = await response.json();
  assert(result.plans.length > 0);
  for (const plan of result.plans) {
    const { summary } = plannerComparisonSummary(plan, 'fluid:nitrofuel');
    assert(!summary.inputs.some(flow => bannedNeededItemIds.includes(flow.item.id) && !summary.recursiveInputIds.includes(flow.item.id)));
  }
});
test('EV seed oil routes satisfy the expanded 17-item needed-ban list within ten steps', async () => {
  const bannedNeededItemIds = [
    'fluid:tetranitromethane', 'gregtech:gt.metaitem.01:30639',
    'fluid:bioethanol', 'gregtech:gt.metaitem.01:30706',
    'fluid:ethenone', 'gregtech:gt.metaitem.01:30641',
    'fluid:methanol', 'gregtech:gt.metaitem.01:30673',
    'gregtech:gt.metaitem.01:30653', 'gregtech:gt.metaitem.01:685',
    'fluid:acetone', 'gregtech:gt.metaitem.01:30717',
    'gregtech:gt.metaitem.01:2685', 'fluid:aceticacid',
    'fluid:nitrogendioxide', 'fluid:saltwater', 'fluid:sulfuricacid',
  ];
  const response = await POST(request({ ...options, inputId: 'fluid:seedoil', targetId: 'fluid:nitrofuel', allowMultiblocks: true, maxTier: 4, maxSteps: 10, maxSuggestions: 10, bannedNeededItemIds }));
  assert.equal(response.status, 200);
  const result: PlannerResult = await response.json();
  assert(result.plans.length > 0);
  for (const plan of result.plans) {
    assert(plan.steps.length <= 10);
    const { summary } = plannerComparisonSummary(plan, 'fluid:nitrofuel');
    assert(!summary.inputs.some(flow => bannedNeededItemIds.includes(flow.item.id) && !summary.recursiveInputIds.includes(flow.item.id)));
  }
});

test("batched candidate loading preserves global ranking for a large output family", async () => {
  const [large] = await catalog.$queryRaw<
    { itemId: string; matches: number }[]
  >`SELECT itemId, COUNT(DISTINCT recipeId) AS matches FROM Ingredient WHERE direction = 'output' GROUP BY itemId ORDER BY matches DESC LIMIT 1`;
  assert(Number(large.matches) > 1000);
  const expected = await catalog.$queryRaw<
    { id: string }[]
  >`SELECT DISTINCT Recipe.id FROM Ingredient JOIN Recipe ON Recipe.id = Ingredient.recipeId WHERE Ingredient.itemId = ${large.itemId} AND Ingredient.direction = 'output' AND Recipe.enabled = 1 ORDER BY Recipe.euPerTick ASC, Recipe.durationTicks ASC, Recipe.id ASC LIMIT 200`;
  const loaded = await plannerRecipes(large.itemId);
  assert.equal(loaded.capped, true);
  assert.deepEqual(
    loaded.recipes.map((recipe) => recipe.id),
    expected.map((recipe) => recipe.id),
  );
});
test("oil cell to diesel cell searches do not exceed SQLite parameter limits", async () => {
  const diesel = await catalog.item.findFirstOrThrow({
    where: { name: "Diesel Cell" },
  });
  const response = await POST(
    request({
      ...options,
      inputId: "gregtech:gt.metaitem.01:30707",
      targetId: diesel.id,
      maxSteps: 10,
      maxSuggestions: 10,
    }),
  );
  assert.equal(response.status, 200);
  const result: PlannerResult = await response.json();
  assert(Array.isArray(result.plans));
  assert(Number.isFinite(result.examined));
  const targetForms = await fluidLookupAmounts(diesel.id);
  const packaging = await emptyFluidContainers(Object.keys(targetForms));
  for (const plan of result.plans) {
    assert(
      plan.steps.some(
        (step) => !["Fluid Canner", "Bottler"].includes(step.recipe.handler),
      ),
    );
    assert(
      !plan.supplies.some((supply) =>
        Object.hasOwn(targetForms, supply.item.id),
      ),
    );
    assert(
      plan.links.every(
        (link) =>
          !packaging.includes(
            plan.steps[link.source].recipe.ingredients.find(
              (i) => i.direction === "output" && i.slot === link.sourceSlot,
            )!.itemId,
          ),
      ),
    );
  }
});
test("light fuel lookup includes filled cells with real capacity in either direction", async () => {
  const fluid = await catalog.item.findFirstOrThrow({
    where: { name: "Light Fuel", kind: "fluid" },
  });
  const amounts = await fluidLookupAmounts(fluid.id);
  const cellId = Object.keys(amounts).find(
    (id) => id.startsWith("gregtech:") && amounts[id] === 0.001,
  );
  assert(cellId, JSON.stringify(amounts));
  const cellAmounts = await fluidLookupAmounts(cellId);
  assert.equal(cellAmounts[fluid.id], 1000);
  assert.equal(cellAmounts[cellId], 1);
  const result: PlannerResult = await (
    await POST(
      request({
        ...options,
        inputId: undefined,
        targetId: fluid.id,
        maxTier: 14,
        allowMultiblocks: true,
        maxSuggestions: 100,
      }),
    )
  ).json();
  assert(
    result.plans.some((plan) =>
      plan.steps
        .at(-1)!
        .recipe.ingredients.some(
          (i) => i.direction === "output" && i.itemId === cellId,
        ),
    ),
  );
  assert(
    result.plans.some((plan) =>
      plan.steps
        .at(-1)!
        .recipe.ingredients.some(
          (i) => i.direction === "output" && i.itemId === fluid.id,
        ),
    ),
  );
  assert.deepEqual(await fluidLookupAmounts("minecraft:stone"), {
    "minecraft:stone": 1,
  });
  for (const targetId of [fluid.id, cellId]) {
    const response = await POST(request({ ...options, inputId: undefined, targetId, exactTarget: true,
      maxTier: 14, allowMultiblocks: true, maxSuggestions: 100 }));
    assert.equal(response.status, 200);
    const exact: PlannerResult = await response.json();
    assert(exact.plans.length > 0);
    for (const plan of exact.plans) {
      const step = plan.steps[0];
      assert.equal(step.recipe.ingredients.find(i => i.direction === "output" && i.slot === step.outputSlot)?.itemId, targetId);
    }
  }
});
test("planner filter choices include actual catalog machines and recipe handlers", async () => {
  const response = await GET();
  assert.equal(response.status, 200);
  const data = await response.json();
  assert(
    data.machines.some(
      (item: { id: string }) => item.id === "etfuturum:blast_furnace",
    ),
  );
  assert(data.recipeTypes.includes("Forge Hammer"));
  assert.equal(
    new Set(data.machines.map((item: { id: string }) => item.id)).size,
    data.machines.length,
  );
});
test("planner validates limits and source requirements", async () => {
  for (const maxSuggestions of [0, 101, 1.5]) {
    assert.equal((await POST(request({ ...options, maxSuggestions }))).status, 400);
  }
  for (const searchDurationSeconds of [30, 120, 600]) {
    assert.equal((await POST(request({ ...options, searchDurationSeconds }))).status, 200);
  }
  assert.equal(
    (await POST(request({ ...options, maxSteps: 101 }))).status,
    400,
  );
  assert.equal(
    (await POST(request({ ...options, priority: "yield", inputId: undefined })))
      .status,
    400,
  );
  assert.equal(
    (await POST(request({ ...options, inputId: options.targetId }))).status,
    400,
  );
});
test("planner searches the installed catalog with hydrated machine choices", async () => {
  const response = await POST(request(options));
  assert.equal(response.status, 200);
  const result: PlannerResult = await response.json();
  assert(result.plans.length > 0);
  assert(result.plans.length <= 3);
  for (const plan of result.plans) {
    assert.equal(plan.steps.length, 1);
    assert(
      plan.steps[0].recipe.ingredients.some(
        (i) => i.itemId === "minecraft:cobblestone" && i.direction === "output",
      ),
    );
    assert(Number.isFinite(plan.totalEu));
  }
});
test("planner finds a multistep cobblestone-to-glass route", async () => {
  const response = await POST(
    request({
      ...options,
      targetId: "minecraft:glass",
      inputId: "minecraft:cobblestone",
      maxSteps: 4,
      maxTier: 3,
    }),
  );
  const result: PlannerResult = await response.json();
  assert(
    result.plans.some((plan) => plan.steps.length > 1),
    JSON.stringify({
      count: result.plans.length,
      examined: result.examined,
      limited: result.limited,
    }),
  );
});


test("benzene initial target searches include fluid and cell recipes in both directions", async () => {
  const fluid = "fluid:benzene", cell = "gregtech:gt.metaitem.01:30686";
  assert.equal((await fluidLookupAmounts(fluid))[cell], 0.001);
  assert.equal((await fluidLookupAmounts(cell))[fluid], 1000);
  for (const targetId of [fluid, cell]) {
    const response = await POST(request({ ...options, inputId: undefined, targetId, maxTier: 14, allowMultiblocks: true, maxSuggestions: 100 }));
    assert.equal(response.status, 200);
    const result: PlannerResult = await response.json();
    const outputs = new Set(result.plans.map(plan => {
      const step = plan.steps.at(-1)!;
      return step.recipe.ingredients.find(i => i.direction === "output" && i.slot === step.outputSlot)?.itemId;
    }));
    assert(outputs.has(fluid)); assert(outputs.has(cell));
  }
});


test("oil-to-diesel prefers producing both heavy and light fuel from oil", async () => {
  for (const priority of ["eu", "yield"]) {
    const response = await POST(request({ ...options, priority,
      inputId: "gregtech:gt.metaitem.01:30707", targetId: "gregtech:gt.metaitem.01:30708",
      maxTier: 2, maxSteps: 10, maxSuggestions: 1,
    }));
    assert.equal(response.status, 200);
    const result: PlannerResult = await response.json();
    assert(result.plans.length > 0);
    const plan = result.plans[0];
    const outputs = new Set(plan.steps.flatMap(step => step.recipe.ingredients.filter(i => i.direction === "output").map(i => i.itemId)));
    assert(outputs.has("fluid:liquid_light_fuel"));
    assert(outputs.has("fluid:liquid_heavy_fuel"));
    assert(plan.steps.some(step => step.recipe.handler === "Electrolyzer"));
    assert(!plan.supplies.some(supply => supply.item.name === "Hydrogen Cell"));
    assert(plan.supplies.every(supply => !/fuel/i.test(supply.item.name)));
    const mixer = plan.steps.findIndex(step => step.recipe.handler === "Mixer");
    assert(mixer >= 0);
    assert.equal(plan.links.filter(link => link.target === mixer).length, 2);
    for (const link of plan.links) {
      const output = plan.steps[link.source].recipe.ingredients.find(i => i.direction === "output" && i.slot === link.sourceSlot);
      const input = plan.steps[link.target].recipe.ingredients.find(i => i.direction === "input" && i.slot === link.targetSlot);
      assert.equal(output?.itemId, input?.itemId);
      const sources = plan.links.filter(other => other.target === link.target && other.targetSlot === link.targetSlot);
      const available = sources.reduce((sum, other) => {
        const step = plan.steps[other.source];
        const output = step.recipe.ingredients.find(i => i.direction === "output" && i.slot === other.sourceSlot)!;
        return sum + output.amount * output.chance * step.cycles;
      }, 0);
      assert(available + 1e-9 >= input!.amount * plan.steps[link.target].cycles);
    }
  }
});

test('MV oil-to-diesel wizard hydrates Forestry container variants before evaluating routes', async () => {
  const diesel = await catalog.item.findFirstOrThrow({ where: { name: 'Diesel Cell' } });
  const response = await POST(request({
    ...options, targetId: diesel.id, inputIds: ['gregtech:gt.metaitem.01:30707'],
    priority: 'yield', priorities: ['yield', 'eu', 'output', 'singleblock'],
    maxTier: 2, allowMultiblocks: true, maxSteps: 10, maxSuggestions: 100,
  }));
  assert.equal(response.status, 200);
  const result: PlannerResult = await response.json();
  assert(result.plans.length > 0);
  const { applyVariants } = await import('../lib/model');
  for (const plan of result.plans) for (const step of plan.steps)
    assert.doesNotThrow(() => applyVariants(step.recipe, step.variants));
});
