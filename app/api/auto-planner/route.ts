import { z } from "zod";
import { catalog } from "@/lib/db";
import { isGtnhInstalled } from "@/lib/game-packs";
import { hydrateRecipeVariants } from "@/lib/recipe-data";
import { findAutoPlans, plannerHandlerAllowed, type PlannerResult } from "@/lib/auto-planner";
import { plannerResultStream } from '@/lib/planner-result-stream';
import { machineTiers } from "@/lib/machine-selection";
import { plannerPriorityIds, validPlannerPriorities } from "@/lib/planner-priorities";
import { fuelValues } from '@/lib/fuel-values';
import { plannerRecipes } from "@/lib/planner-catalog";
import { searchPlannerUntilDeadline } from '@/lib/planner-search';
import { defaultPlannerSearchDuration } from '@/lib/planner-search-settings';

export const maxDuration = 60;
import {
  fluidLookupAmounts,
  emptyFluidContainers,
} from "@/lib/fluid-containers";

const schema = z.object({
  targetId: z.string().min(1).max(500),
  exactTarget: z.boolean().default(false),
  inputId: z.string().min(1).max(500).optional(),
  inputIds: z.array(z.string().min(1).max(500)).max(100).optional(),
  priority: z.enum(["yield", "eu", "output"]),
  priorities: z.array(z.enum(plannerPriorityIds)).min(4).max(5).refine(validPlannerPriorities).optional(),
  allowMultiblocks: z.boolean(),
  balanceMachines: z.boolean().default(true),
  maxTotalEu: z.number().finite().nonnegative().optional(),
  maxTier: z
    .number()
    .int()
    .min(0)
    .max(machineTiers.length - 1),
  maxSteps: z.number().int().min(1).max(100),
  maxSuggestions: z.number().int().min(1).max(100),
  searchDurationSeconds: z.unknown().transform(() => defaultPlannerSearchDuration).default(defaultPlannerSearchDuration),
  excludedRecipes: z.array(z.string().max(500)).max(1000).default([]),
  excludedPlans: z.array(z.string().max(100000)).max(1000).default([]),
  bannedMachineIds: z.array(z.string().max(500)).max(10000).default([]),
  bannedNeededItemIds: z.array(z.string().min(1).max(500)).max(10000).default([]),
  recipeTypes: z.array(z.string().max(500)).max(1000).default([]),
});

export async function POST(request: Request) {
  if (!isGtnhInstalled())
    return Response.json(
      { error: "Install the GTNH game pack first." },
      { status: 409 },
    );
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return Response.json(
      { error: "Invalid planner request." },
      { status: 400 },
    );
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success)
    return Response.json(
      { error: "Choose valid items and limits (1–100 steps and suggestions)." },
      { status: 400 },
    );
  const options = parsed.data;
  const selectedInputIds = [...new Set(options.inputIds ?? (options.inputId ? [options.inputId] : []))];
  options.bannedNeededItemIds = options.bannedNeededItemIds.filter(id => !selectedInputIds.includes(id));
  if (selectedInputIds.includes(options.targetId))
    return Response.json(
      { error: "Choose different input and target items." },
      { status: 400 },
    );
  if (!options.priorities && options.priority === "yield" && !selectedInputIds.length)
    return Response.json(
      { error: "Choose an input item to compare output yield." },
      { status: 400 },
    );
  if (request.headers.get('accept')?.includes('application/x-ndjson')) {
    return new Response(plannerResultStream((signal, publish) => runSearch(options, signal, publish), request.signal, options.searchDurationSeconds * 1000), {
      headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' },
    });
  }
  return Response.json(await runSearch(options, request.signal));
}

async function runSearch(options: z.infer<typeof schema>, signal: AbortSignal, publish?: (result: PlannerResult) => void) {
  const selectedInputIds = [...new Set(options.inputIds ?? (options.inputId ? [options.inputId] : []))];
  const started = Date.now();
  const stopped = () => signal.aborted || Date.now() - started >= options.searchDurationSeconds * 1000;
  const emptyResult: PlannerResult = { plans: [], examined: 0, limited: true };
  if (stopped()) return emptyResult;
  const [targetAmounts, inputForms] = await Promise.all([
    options.exactTarget ? Promise.resolve({ [options.targetId]: 1 }) : fluidLookupAmounts(options.targetId),
    Promise.all(selectedInputIds.map(id => fluidLookupAmounts(id))),
  ]);
  const inputFactors: Record<string, number> = {};
  for (const forms of inputForms) for (const [id, amount] of Object.entries(forms)) {
    inputFactors[id] = Math.min(inputFactors[id] ?? Infinity, 1 / amount);
  }
  const inputIds = Object.keys(inputFactors);
  options = { ...options, bannedNeededItemIds: options.bannedNeededItemIds.filter(id => !inputIds.includes(id)) };
  const packagingItemIds = await emptyFluidContainers([
    ...new Set([...Object.keys(targetAmounts), ...inputIds]),
  ]);
  if (stopped()) return emptyResult;
  const sourceRecipes: { recipeId: string }[] = [];
  for (let start = 0; start < inputIds.length; start += 300) {
    if (stopped()) return emptyResult;
    const batch = inputIds.slice(start, start + 300);
    sourceRecipes.push(
      ...(await catalog.ingredient.findMany({
        where: { itemId: { in: batch }, direction: "input" },
        select: { recipeId: true },
        distinct: ["recipeId"],
        take: 500,
      })),
    );
    const variants = await catalog.ingredientVariant.findMany({
      where: { itemId: { in: batch }, ingredient: { direction: "input" } },
      select: { ingredient: { select: { recipeId: true } } },
      take: 500,
    });
    sourceRecipes.push(
      ...variants.map((variant) => ({ recipeId: variant.ingredient.recipeId })),
    );
  }
  const sourceIds = [
    ...new Set(sourceRecipes.map((recipe) => recipe.recipeId)),
  ];
  const nearInputIds = new Set<string>();
  for (let start = 0; start < sourceIds.length; start += 300) {
    if (stopped()) return emptyResult;
    const nearby = await catalog.ingredient.findMany({
      where: {
        recipeId: { in: sourceIds.slice(start, start + 300) },
        direction: "output",
      },
      select: { itemId: true },
      distinct: ["itemId"],
    });
    nearby.forEach((item) => nearInputIds.add(item.itemId));
  }
  const searchOptions = {
      ...options,
      fuelEuPerUnit: options.priorities?.includes('netFuel') ? Object.fromEntries(Object.entries(await fuelValues(Object.keys(targetAmounts))).map(([id, fuel]) => [id, fuel.euPerUnit])) : undefined,
      targetAmounts,
      inputFactors,
      packagingItemIds,
      nearInputIds: [...nearInputIds],
    };
  const recipeCache = new Map<string, { limit: number; loaded: Awaited<ReturnType<typeof plannerRecipes>> }>();
  const result = await searchPlannerUntilDeadline(async (budget, interrupted) => {
    let capped = false;
    const candidateLimit = Math.min(10000, 200 * budget / 5000);
    const attempt = await findAutoPlans(searchOptions, async itemId => {
      if (interrupted()) return [];
      let entry = recipeCache.get(itemId);
      if (!entry || (entry.loaded.capped && entry.limit < candidateLimit)) {
        entry = { limit: candidateLimit, loaded: await plannerRecipes(itemId, options.recipeTypes, options.excludedRecipes, candidateLimit) };
        recipeCache.set(itemId, entry);
      }
      capped ||= entry.loaded.capped;
      return entry.loaded.recipes;
    }, interrupted, budget, publish);
    return { ...attempt, limited: attempt.limited || capped };
  }, {
    aborted: stopped,
    timeoutMs: Math.max(0, options.searchDurationSeconds * 1000 - (Date.now() - started)),
    maxSuggestions: options.maxSuggestions,
  });
  const selected = [
    ...new Map(
      result.plans.flatMap((plan) =>
        plan.steps.map((step) => [step.recipe.id, step.recipe] as const),
      ),
    ).values(),
  ];
  const hydrated = new Map<string, (typeof selected)[number]>();
  for (let start = 0; start < selected.length; start += 100) {
    if (stopped()) break;
    for (const recipe of await hydrateRecipeVariants(
      selected.slice(start, start + 100),
    ))
      hydrated.set(recipe.id, recipe);
  }
  for (const plan of result.plans)
    for (const step of plan.steps) step.recipe = hydrated.get(step.recipe.id) ?? step.recipe;
  return result;
}

export async function GET() {
  if (!isGtnhInstalled())
    return Response.json(
      { error: "Install the GTNH game pack first." },
      { status: 409 },
    );
  const [rows, handlers] = await Promise.all([
    catalog.$queryRaw<
      { id: string }[]
    >`SELECT DISTINCT machine.value AS id FROM Recipe, json_each(CASE WHEN json_valid(Recipe.layout) THEN Recipe.layout ELSE '{}' END, '$.machineIds') AS machine WHERE Recipe.enabled = 1 AND machine.type = 'text'`,
    catalog.recipe.findMany({
      where: { enabled: true },
      distinct: ["handler"],
      select: { handler: true },
    }),
  ]);
  const ids = [
    ...new Set([
      ...rows.map((row) => row.id),
      "etfuturum:blast_furnace",
      "gregtech:gt.blockmachines:1000",
      "gregtech:gt.blockmachines:15412",
    ]),
  ];
  const machines = [];
  for (let start = 0; start < ids.length; start += 500)
    machines.push(
      ...(await catalog.item.findMany({
        where: { id: { in: ids.slice(start, start + 500) } },
      })),
    );
  machines.sort((a, b) =>
    a.name.replace(/§./g, "").localeCompare(b.name.replace(/§./g, "")),
  );
  return Response.json({
    machines,
    recipeTypes: handlers
      .map((row) => row.handler)
      .filter(plannerHandlerAllowed)
      .sort((a, b) => a.localeCompare(b)),
  });
}
