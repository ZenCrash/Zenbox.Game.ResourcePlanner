import {
  ingredientVariants,
  applyVariants,
  hasRecipeTiming,
  type Item,
  type Recipe,
  type VariantSelection,
} from "./model";
import { machineOptions, machineTier, machineTiers, selectedMachine } from "./machine-selection";
import { overclockRecipe } from "./recipe-overclock";
import { recipePowerInfo } from "./recipe-power";
import { canonicalRecipeHandler } from "./recipe-handlers";
import type { PlannerPriority } from "./planner-priorities";
import type { MultiblockConfig } from "./multiblock";
import { multiblockProfile } from "./multiblock";
import { plannerMachineConfigurations } from "./planner-machine-options";
import { plannerNormalizedTotalEu, plannerComparisonSummary } from './planner-balance';
import { normalizedNetFuelValue } from './summary-rate';
import { PriorityQueue } from './priority-queue';
import { knownPlannerMultiblock, plannerControllerAllowed } from './planner-progression';

let lastSearchYield = 0;
async function yieldSearchWork() {
  if (Date.now() - lastSearchYield < 8) return;
  await new Promise(resolve => setTimeout(resolve, 0));
  lastSearchYield = Date.now();
}

export function plannerHandlerAllowed(handler: string) {
  return !["Combustion Generator Fuels", "Semifluid Generator Fuels", "Gas Turbine Fuel", "Gas Turbine Fuels", "Large Boiler"].includes(canonicalRecipeHandler(handler));
}

export type PlannerOptions = {
  targetId: string;
  exactTarget?: boolean;
  inputId?: string;
  inputIds?: string[];
  priority: "yield" | "eu" | "output";
  priorities?: PlannerPriority[];
  allowMultiblocks: boolean;
  maxTier: number;
  maxTotalEu?: number;
  balanceMachines?: boolean;
  fuelEuPerUnit?: Record<string, number>;
  maxSteps: number;
  maxSuggestions: number;
  searchDurationSeconds?: number;
  excludedRecipes: string[];
  excludedPlans: string[];
  nearInputIds?: string[];
  bannedMachineIds?: string[];
  bannedNeededItemIds?: string[];
  recipeTypes?: string[];
  targetAmounts?: Record<string, number>;
  inputFactors?: Record<string, number>;
  packagingItemIds?: string[];
};
export type PlannerStep = {
  recipe: Recipe;
  machineId?: string;
  multiblock?: MultiblockConfig;
  variants: VariantSelection;
  inputSlot?: number;
  outputSlot: number;
  cycles: number;
  recovery?: boolean;
};
export type PlannerPlan = {
  balanceMachines?: boolean;
  targetOutputId?: string;
  key: string;
  steps: PlannerStep[];
  totalEu: number;
  inputAmount: number;
  outputPerBatch?: number;
  supplies: { item: Item; amount: number }[];
  links: {
    source: number;
    target: number;
    sourceSlot: number;
    targetSlot: number;
  }[];
};
export type PlannerResult = {
  stopReason?: 'cancelled' | 'timeout';
  plans: PlannerPlan[];
  limited: boolean;
  examined: number;
};

export function isPlannerMultiblock(recipe: Recipe, machine?: Item) {
  if (machine && knownPlannerMultiblock(machine)) return true;
  if (machine && /^(minecraft|etfuturum|IC2):/.test(machine.registryId))
    return false;
  if (machine && machineTier(machine))
    return /multiblock|multi-block|multi block|controller/i.test(
      `${machine.name} ${machine.tooltip}`,
    );
  const text =
    `${recipe.handler} ${machine?.name ?? ""} ${machine?.tooltip ?? ""}`.replace(
      /§./g,
      "",
    );
  return (
    /multiblock|multi-block|multi block|controller|industrial|large |blast furnace|distillation tower|fusion reactor|processing array|assembly line|power forge/i.test(
      text,
    ) ||
    (!!machine?.registryId.startsWith("gregtech:") && !machineTier(machine))
  );
}

export function plannerMachine(
  recipe: Recipe,
  options: PlannerOptions,
): { machineId?: string; runtime: Recipe; multiblock?: MultiblockConfig } | null {
  if (!plannerHandlerAllowed(recipe.handler)) return null;
  if (
    options.recipeTypes?.length &&
    !options.recipeTypes.includes(recipe.handler)
  )
    return null;
  const tier = recipePowerInfo(recipe).voltage?.match(/\((\w+)\)/)?.[1];
  const machines = machineOptions(recipe).options;
  const eligible = machines.filter((machine) => {
    const tier = machineTier(machine);
    return (
      !options.bannedMachineIds?.includes(machine.id) &&
      (!tier || machineTiers.indexOf(tier) <= options.maxTier) &&
      (!isPlannerMultiblock(recipe, machine) || plannerControllerAllowed(machine, options.maxTier)) &&
      (options.allowMultiblocks || !isPlannerMultiblock(recipe, machine))
    );
  });
  if (machines.length && !eligible.length) return null;
  if (
    !machines.length &&
    !options.allowMultiblocks &&
    isPlannerMultiblock(recipe)
  )
    return null;
  const candidates = (eligible.length ? eligible : [undefined])
    .flatMap(machine => {
      const profile = multiblockProfile(recipe, machine?.id);
      if ((!profile || profile.kind === "hatch-only") && tier && machineTiers.indexOf(tier) > options.maxTier) return [];
      return plannerMachineConfigurations(recipe, machine?.id, options.maxTier);
    })
    .filter(
      ({ runtime }) =>
        runtime.euPerTick >= 0 &&
        (runtime.euPerTick === 0 || runtime.durationTicks > 0),
    );
  const machinePreference = (a: typeof candidates[number], b: typeof candidates[number]) =>
    Number(isPlannerMultiblock(recipe, selectedMachine(recipe, a.machineId))) -
    Number(isPlannerMultiblock(recipe, selectedMachine(recipe, b.machineId)));
  const energy = (runtime: Recipe) => runtime.euPerTick * (runtime.cycleDurationTicks ?? runtime.durationTicks) / (runtime.parallel ?? 1);
  const speed = (runtime: Recipe) => (runtime.parallel ?? 1) / Math.max(1, runtime.cycleDurationTicks ?? runtime.durationTicks);
  candidates.sort((a, b) => {
    for (const priority of options.priorities ?? ["eu", "singleblock"]) {
      const order = priority === "eu" ? energy(a.runtime) - energy(b.runtime)
        : priority === "output" ? (b.runtime.parallel ?? 1) - (a.runtime.parallel ?? 1)
        : priority === "singleblock" ? machinePreference(a, b) : 0;
      if (order) return order;
    }
    return speed(b.runtime) - speed(a.runtime);
  });
  return candidates[0] ?? null;
}

function stepIngredients(step: PlannerStep) {
  return overclockRecipe(applyVariants(step.recipe, step.variants), step.machineId, step.multiblock).ingredients;
}

/** Banned materials must have a producer that can start without importing a
 * banned material. Merely occurring as an output in a recycling loop is not
 * enough. Partial supply is allowed once its producer is reachable. */
export function plannerStartupMaterials(plan: PlannerPlan, banned: ReadonlySet<string>) {
  const available = new Set<string>();
  const remaining = plan.steps.map(step => ({ step, ingredients: stepIngredients(step) }));
  let changed = true;
  while (changed) {
    changed = false;
    for (let index = remaining.length - 1; index >= 0; index--) {
      const { step, ingredients } = remaining[index];
      if (!hasRecipeTiming(step.recipe) || ingredients.some(i => i.direction === 'input' && i.consumed && i.amount > 0 && banned.has(i.itemId) && !available.has(i.itemId))) continue;
      for (const output of ingredients)
        if (output.direction === 'output' && output.amount * output.chance > 0) available.add(output.itemId);
      remaining.splice(index, 1);
      changed = true;
    }
  }
  const missing = new Set(plan.steps.flatMap(step => stepIngredients(step).filter(i => i.direction === 'input' && i.consumed && i.amount > 0 && banned.has(i.itemId) && !available.has(i.itemId)).map(i => i.itemId)));
  return { available, missing };
}

/** Filling/draining carries the contents, not the empty packaging. Following
 * the empty bucket output can otherwise turn any bottled fluid into any other
 * one by buying the desired fluid externally and reusing the bucket.
 */
export function plannerConversionInputs(
  recipe: Recipe,
  outputSlot: number,
  packagingIsTarget = false,
) {
  const inputs = recipe.ingredients.filter(
    (i) => i.direction === "input" && i.consumed && i.amount > 0,
  );
  if (recipe.handler !== "Fluid Canner" && recipe.handler !== "Bottler")
    return inputs;
  const output = recipe.ingredients.find(
    (i) => i.direction === "output" && i.slot === outputSlot,
  );
  if (!output) return [];
  const fluidInput = inputs.filter((i) => i.item.kind === "fluid");
  const fluidOutput = recipe.ingredients.some(
    (i) => i.direction === "output" && i.item.kind === "fluid",
  );
  if (fluidInput.length) return fluidInput;
  if (fluidOutput)
    return output.item.kind === "fluid" || packagingIsTarget ? inputs : [];
  // Bottler exports without their fluid ingredient cannot establish a
  // material conversion from the empty bottle alone.
  return [];
}

function isContainerConversion(recipe: Recipe) {
  if (recipe.handler === 'Fluid Canner' || recipe.handler === 'Bottler') return true;
  const inputs = recipe.ingredients.filter(i => i.direction === "input" && i.consumed && i.amount > 0);
  const outputs = recipe.ingredients.filter(i => i.direction === "output" && i.amount > 0);
  const fluids = inputs.filter(i => i.item.kind === "fluid");
  if (outputs.some(i => i.item.kind === "fluid")) return false;
  if (recipe.handler === "Bottler") return outputs.some(i => i.item.kind !== "fluid");
  if (!fluids.length) return false;
  return recipe.handler === "Fluid Canner" || outputs.some(output =>
    fluids.some(fluid => output.item.containedFluidIds?.includes(fluid.itemId) ||
      output.item.fluidContents?.some(contents => contents.fluidId === fluid.itemId)),
  );
}

/** A conversion route; other inputs are explicitly counted as external supplies.
 * Costs are expected EU per one target unit, including probabilistic outputs.
 * No free-energy credit is assigned to byproducts or cyclic conversions.
 */
async function findRoutes(
  options: PlannerOptions,
  recipesFor: (itemId: string) => Promise<Recipe[]>,
  interrupted: () => boolean = () => false,
  budget = 5000,
  allowExternalInputs = false,
  machineCache = new Map<Recipe, ReturnType<typeof plannerMachine>>(),
): Promise<PlannerResult> {
  type State = {
    itemId: string;
    amount: number;
    steps: PlannerStep[];
    eu: number;
    visited: string[];
  };
  const inputFactors =
    options.inputFactors ?? Object.fromEntries((options.inputIds ?? (options.inputId ? [options.inputId] : [])).map(id => [id, 1]));
  const hasInputs = Object.keys(inputFactors).length > 0;
  const isSource = (id: string) => Object.hasOwn(inputFactors, id);
  const queue = new PriorityQueue<State>((a, b) =>
    Number(a.steps.length > 0) - Number(b.steps.length > 0) ||
    Number(options.nearInputIds?.includes(b.itemId) ?? false) - Number(options.nearInputIds?.includes(a.itemId) ?? false) ||
    ((options.priorities?.[0] ?? options.priority) === 'eu'
      ? a.eu - b.eu || a.steps.length - b.steps.length
      : a.steps.length - b.steps.length || a.amount - b.amount));
  Object.entries(
    options.exactTarget ? { [options.targetId]: 1 } : options.targetAmounts ?? { [options.targetId]: 1 },
  ).forEach(([itemId, amount]) => queue.push({
    itemId,
    amount,
    steps: [],
    eu: 0,
    visited: [],
  }));
  const found = new Map<string, PlannerPlan>();
  const cache = new Map<string, Promise<Recipe[]>>();
  const excluded = new Set(options.excludedRecipes);
  let examined = 0;
  let limited = false;
  const finish = (state: State) => {
    const steps = state.steps.toReversed();
    // Container conversions may finish a production route, but cannot start
    // operation. This also covers standalone and nested ingredient searches.
    if (steps[0] && isContainerConversion(steps[0].recipe)) return;
    const key = steps
      .map(
        (step) =>
          `${step.recipe.id}:${step.inputSlot ?? "_"}:${step.outputSlot}:${JSON.stringify(step.variants)}${step.multiblock ? ":" + JSON.stringify(step.multiblock) : ""}`,
      )
      .join("|");
    if (options.excludedPlans.includes(key)) return;
    const supplies = new Map<string, { item: Item; amount: number }>();
    for (const step of steps)
      for (const input of stepIngredients(step)) {
        if (
          input.direction !== "input" ||
          !input.consumed ||
          input.amount <= 0 ||
          input.slot === step.inputSlot
        )
          continue;
        const existing = supplies.get(input.itemId);
        supplies.set(input.itemId, {
          item: input.item,
          amount: (existing?.amount ?? 0) + input.amount * step.cycles,
        });
      }
    // A repeated source in an auxiliary slot still contributes to the yield denominator.
    let extraSource = 0;
    for (const [id, factor] of Object.entries(inputFactors)) {
      extraSource += (supplies.get(id)?.amount ?? 0) * factor;
      supplies.delete(id);
    }
    if (
      hasInputs &&
      Object.keys(options.targetAmounts ?? { [options.targetId]: 1 }).some(
        (id) => (supplies.get(id)?.amount ?? 0) > 0,
      )
    )
      return;
    const links = steps.slice(1).map((step, index) => ({
      source: index,
      target: index + 1,
      sourceSlot: steps[index].outputSlot,
      targetSlot: step.inputSlot!,
    }));
    found.set(key, {
      key,
      balanceMachines: options.balanceMachines !== false,
      targetOutputId: state.steps[0]?.recipe.ingredients.find(i => i.direction === 'output' && i.slot === state.steps[0].outputSlot)?.itemId,
      steps,
      links,
      totalEu: state.eu,
      outputPerBatch: (overclockRecipe(steps.at(-1)!.recipe, steps.at(-1)!.machineId, steps.at(-1)!.multiblock).parallel ?? 1) / steps.at(-1)!.cycles,
      inputAmount:
        state.amount * (inputFactors[state.itemId] ?? (hasInputs ? 0 : 1)) + extraSource,
      supplies: [...supplies.values()],
    });
  };
  while (queue.length) {
    if (interrupted() || examined >= budget) {
      limited = true;
      break;
    }
    // EU is a nonnegative lower bound. Yield paths are explored by depth to avoid
    // repeatedly following a locally attractive recycling chain.
    const state = queue.shift()!;
    if (state.steps.length && isSource(state.itemId)) {
      finish(state);
      continue;
    }
    if (
      state.steps.length >= options.maxSteps ||
      (state.steps.length > 0 &&
        options.packagingItemIds?.includes(state.itemId)) ||
      state.visited.includes(state.itemId)
    )
      continue;
    if (!cache.has(state.itemId))
      cache.set(state.itemId, recipesFor(state.itemId));
    for (const recipe of await cache.get(state.itemId)!) {
      await yieldSearchWork();
      if (interrupted()) { limited = true; break; }
      if (++examined > budget) {
        limited = true;
        break;
      }
      if (
        excluded.has(recipe.id) ||
        state.steps.some((step) => step.recipe.id === recipe.id)
      )
        continue;
      if (!machineCache.has(recipe)) machineCache.set(recipe, plannerMachine(recipe, options));
      const machine = machineCache.get(recipe)!;
      if (!machine) continue;
      const outputs = recipe.ingredients.filter(
        (i) =>
          i.direction === "output" &&
          i.itemId === state.itemId &&
          i.amount > 0 &&
          i.chance > 0,
      );
      if (!outputs.length) continue;
      outputs.sort((a, b) => b.amount * b.chance - a.amount * a.chance);
      const amount = outputs[0].amount * outputs[0].chance;
      const cycles = state.amount / amount;
      const eu =
        state.eu +
        cycles *
          machine.runtime.euPerTick *
          Math.max(0, machine.runtime.cycleDurationTicks ?? machine.runtime.durationTicks) /
          (machine.runtime.parallel ?? 1);
      if (!Number.isFinite(eu) || !Number.isFinite(cycles)) continue;
      const step: PlannerStep = {
        recipe,
        machineId: machine.machineId,
        multiblock: machine.multiblock,
        variants: {},
        outputSlot: outputs[0].slot,
        cycles,
      };
      if (!hasInputs || allowExternalInputs) {
        finish({ ...state, steps: [...state.steps, step], eu });
        continue;
      }
      const inputs = plannerConversionInputs(
        machine.runtime,
        step.outputSlot,
        state.steps.length === 0 && state.itemId === options.targetId,
      );
      for (const input of inputs) {
        for (const { id: itemId } of ingredientVariants(input)) {
          if (state.visited.includes(itemId) || itemId === state.itemId)
            continue;
          if (
            !Number.isFinite(input.amount * cycles) ||
            input.amount * cycles <= 0
          )
            continue;
          const next = {
            ...step,
            inputSlot: input.slot,
            variants:
              itemId === input.itemId
                ? {}
                : { [`input:${input.slot}`]: itemId },
          };
          const nextState = {
            itemId,
            amount: input.amount * cycles,
            steps: [...state.steps, next],
            eu,
            visited: [...state.visited, state.itemId],
          };
          if (isSource(itemId)) finish(nextState);
          else if (queue.length < Math.min(budget, 20000)) queue.push(nextState);
          else limited = true;
          if (queue.length >= Math.min(budget, 20000)) {
            limited = true;
            break;
          }
        }
        if (queue.length >= Math.min(budget, 20000)) break;
      }
    }
  }
  const plans = [...found.values()].sort((a, b) => comparePlans(options, a, b));
  return { plans: plans.slice(0, options.maxSuggestions), limited, examined };
}

function compareDependencies(options: PlannerOptions, a: PlannerPlan, b: PlannerPlan) {
  // Empty packaging is still required, but must not outweigh producing an
  // actual ingredient from the chosen source.
  const materials = (plan: PlannerPlan) => plan.supplies.filter(
    (supply) => !options.packagingItemIds?.includes(supply.item.id),
  ).length;
  return materials(a) - materials(b) || a.supplies.length - b.supplies.length;
}

const comparisonCaches = new WeakMap<PlannerOptions, { metrics: WeakMap<PlannerPlan, PlannerPlan>; fuel: WeakMap<PlannerPlan, number>; multiblocks: WeakMap<PlannerPlan, number> }>();
function comparePlans(options: PlannerOptions, a: PlannerPlan, b: PlannerPlan) {
  let cache = comparisonCaches.get(options);
  if (!cache) { cache = { metrics: new WeakMap(), fuel: new WeakMap(), multiblocks: new WeakMap() }; comparisonCaches.set(options, cache); }
  // One-machine mode compares the actual unscaled group rates and energy.
  // Keep route cycles intact: they are still needed to discover dependencies.
  const metrics = (plan: PlannerPlan) => {
    if (options.balanceMachines !== false) return plan;
    const cached = cache!.metrics.get(plan);
    if (cached) return cached;
    const { summary, output } = plannerComparisonSummary(plan, options.targetId);
    const rate = output?.rate ?? 0;
    const sources = options.inputFactors ?? Object.fromEntries((options.inputIds ?? (options.inputId ? [options.inputId] : [])).map(id => [id, 1]));
    const result = { ...plan, totalEu: plannerNormalizedTotalEu(plan, options.targetId),
      outputPerBatch: rate / (output?.item.kind === 'fluid' ? 1000 : 1),
      inputAmount: rate > 0 ? summary.inputs.reduce((sum, flow) => sum + flow.rate * (sources[flow.item.id] ?? 0), 0) / rate : Infinity };
    cache!.metrics.set(plan, result);
    return result;
  };
  a = metrics(a); b = metrics(b);
  const netFuel = (plan: PlannerPlan) => {
    const cached = cache!.fuel.get(plan);
    if (cached !== undefined) return cached;
    const fuel = options.fuelEuPerUnit?.[plan.targetOutputId ?? options.targetId];
    if (!fuel) return 0;
    const { summary, output } = plannerComparisonSummary(plan, options.targetId);
    const value = output ? normalizedNetFuelValue(output.rate * fuel - summary.euPerTick * 20, output.rate, output.item.kind === 'fluid') : -Infinity;
    cache!.fuel.set(plan, value);
    return value;
  };
  const multiblocks = (plan: PlannerPlan) => {
    const cached = cache!.multiblocks.get(plan);
    if (cached !== undefined) return cached;
    const value = plan.steps.filter(step =>
    isPlannerMultiblock(step.recipe, selectedMachine(step.recipe, step.machineId)),
  ).length;
    cache!.multiblocks.set(plan, value);
    return value;
  };
  if (options.priorities) {
    const dependencyOrder = compareDependencies(options, a, b);
    if (dependencyOrder) return dependencyOrder;
    const hasInputs = !!(options.inputIds?.length || options.inputId || Object.keys(options.inputFactors ?? {}).length);
    for (const priority of options.priorities) {
      const order = priority === "eu" ? a.totalEu - b.totalEu
        : priority === 'netFuel' ? netFuel(b) - netFuel(a)
        : priority === "output" ? (b.outputPerBatch ?? 0) - (a.outputPerBatch ?? 0)
        : priority === "yield" ? hasInputs ? a.inputAmount - b.inputAmount : 0
        : multiblocks(a) - multiblocks(b);
      if (order) return order;
    }
    return a.steps.length - b.steps.length || a.key.localeCompare(b.key);
  }
  return (
    compareDependencies(options, a, b) ||
    (options.priority === "yield"
      ? a.inputAmount - b.inputAmount
      : options.priority === "output"
        ? (b.outputPerBatch ?? 0) - (a.outputPerBatch ?? 0)
        : a.totalEu - b.totalEu) ||
    a.totalEu - b.totalEu ||
    a.steps.length - b.steps.length ||
    multiblocks(a) - multiblocks(b) ||
    a.key.localeCompare(b.key)
  );
}

function reuseByproducts(plan: PlannerPlan): PlannerPlan {
  const spare = spareByproducts(plan);
  const links = [...plan.links];
  const connected = new Set(
    links.map((link) => `${link.target}:${link.targetSlot}`),
  );
  const reused = new Map<string, number>();
  const reaches = (
    from: number,
    to: number,
    seen = new Set<number>(),
  ): boolean => {
    if (from === to) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return links.some(
      (link) => link.source === from && reaches(link.target, to, seen),
    );
  };
  plan.steps.forEach((producer, source) => {
    for (const output of stepIngredients(producer)) {
      if (
        output.direction !== "output" ||
        output.slot === producer.outputSlot ||
        !plan.supplies.some((supply) => supply.item.id === output.itemId)
      )
        continue;
      let available = spare.find(entry => entry.source === source && entry.slot === output.slot)?.amount ?? 0;
      plan.steps.forEach((consumer, target) => {
        if (reaches(target, source)) return;
        for (const input of stepIngredients(consumer)) {
          if (
            input.direction !== "input" ||
            !input.consumed ||
            input.amount <= 0 ||
            input.itemId !== output.itemId ||
            connected.has(`${target}:${input.slot}`)
          )
            continue;
          const required = input.amount * consumer.cycles;
          const supplied = Math.min(available, required);
          if (supplied <= 1e-9) continue;
          available -= supplied;
          connected.add(`${target}:${input.slot}`);
          links.push({
            source,
            target,
            sourceSlot: output.slot,
            targetSlot: input.slot,
          });
          reused.set(input.itemId, (reused.get(input.itemId) ?? 0) + supplied);
        }
      });
    }
  });
  if (!reused.size) return plan;
  return {
    ...plan,
    links,
    key: `${plan.key}~reuse`,
    supplies: plan.supplies
      .map((supply) => ({
        ...supply,
        amount: Math.max(0, supply.amount - (reused.get(supply.item.id) ?? 0)),
      }))
      .filter((supply) => supply.amount > 1e-9),
  };
}

// Reserve target outputs and already allocated connections before considering
// recycling. Several producers may jointly supply one recovery input.
function spareByproducts(plan: PlannerPlan) {
  const outputs = plan.steps.flatMap((step, source) => stepIngredients(step)
    .filter(i => i.direction === "output" && i.amount > 0 && i.chance > 0)
    .map(i => ({ source, slot: i.slot, itemId: i.itemId,
      amount: i.amount * i.chance * step.cycles, primary: i.slot === step.outputSlot })));
  const targets = new Map<string, typeof plan.links>();
  for (const link of plan.links) {
    const key = link.target + ":" + link.targetSlot;
    targets.set(key, [...(targets.get(key) ?? []), link]);
  }
  for (const links of targets.values()) {
    const first = links[0], step = plan.steps[first.target];
    const input = stepIngredients(step).find(i => i.direction === "input" && i.slot === first.targetSlot)!;
    let remaining = input.amount * step.cycles;
    for (const link of links) {
      const output = outputs.find(o => o.source === link.source && o.slot === link.sourceSlot)!;
      const used = Math.min(output.amount, remaining);
      output.amount -= used; remaining -= used;
    }
  }
  return outputs.filter(o => !o.primary && o.amount > 1e-9);
}

async function recoverByproducts(
  original: PlannerPlan, options: PlannerOptions,
  lookup: (id: string) => Promise<Recipe[]>, interrupted: () => boolean,
  budget: number,
): Promise<PlannerResult> {
  let plan = original, examined = 0, limited = false;
  while (plan.supplies.length && plan.steps.length < options.maxSteps) {
    const available = spareByproducts(plan);
    if (!available.length) break;
    const candidates: PlannerPlan[] = [];
    for (const supply of plan.supplies) {
      if (interrupted() || examined >= budget) { limited = true; break; }
      for (const recipe of await lookup(supply.item.id)) {
        if (interrupted() || examined >= budget) { limited = true; break; }
        examined++;
        if (options.excludedRecipes.includes(recipe.id) || plan.steps.some(s => s.recipe.id === recipe.id)) continue;
        const machine = plannerMachine(recipe, options);
        if (!machine) continue;
        const output = recipe.ingredients.find(i => i.direction === "output" && i.itemId === supply.item.id && i.amount > 0 && i.chance > 0);
        if (!output || !plannerConversionInputs(recipe, output.slot).length) continue;
        const cycles = supply.amount / (output.amount * output.chance);
        const stock = available.map(o => ({ ...o }));
        const links = [...plan.links], variants: VariantSelection = {};
        const index = plan.steps.length;
        let valid = true, fed = false;
        for (const input of machine.runtime.ingredients.filter(i => i.direction === "input" && i.consumed && i.amount > 0)) {
          const required = input.amount * cycles;
          const id = ingredientVariants(input).map(item => item.id).find(id => stock.filter(o => o.itemId === id).reduce((n, o) => n + o.amount, 0) + 1e-9 >= required);
          if (!id) { valid = false; break; }
          if (id !== input.itemId) variants["input:" + input.slot] = id;
          let remaining = required;
          for (const source of stock.filter(o => o.itemId === id)) {
            const used = Math.min(source.amount, remaining);
            if (used <= 1e-9) continue;
            links.push({ source: source.source, sourceSlot: source.slot, target: index, targetSlot: input.slot });
            source.amount -= used; remaining -= used; fed = true;
          }
        }
        if (!valid || !fed) continue;
        let demand = 0;
        plan.steps.forEach((step, target) => {
          for (const input of stepIngredients(step)) {
            if (input.direction !== "input" || !input.consumed || input.amount <= 0 ||
              (step.variants["input:" + input.slot] ?? input.itemId) !== supply.item.id ||
              plan.links.some(l => l.target === target && l.targetSlot === input.slot)) continue;
            demand += input.amount * step.cycles;
            links.push({ source: index, sourceSlot: output.slot, target, targetSlot: input.slot });
          }
        });
        if (Math.abs(demand - supply.amount) > 1e-7 * Math.max(1, supply.amount)) continue;
        const candidate: PlannerPlan = {
          ...plan, key: plan.key + "~recover:" + recipe.id + ":" + output.slot,
          steps: [...plan.steps, { recipe, machineId: machine.machineId, multiblock: machine.multiblock, variants, cycles, outputSlot: output.slot, recovery: true }],
          links, totalEu: plan.totalEu + cycles * machine.runtime.euPerTick * Math.max(0, machine.runtime.cycleDurationTicks ?? machine.runtime.durationTicks) / (machine.runtime.parallel ?? 1),
          supplies: plan.supplies.filter(s => s.item.id !== supply.item.id),
        };
        if (!options.excludedPlans.includes(candidate.key)) candidates.push(candidate);
      }
    }
    candidates.sort((a, b) => comparePlans(options, a, b));
    if (!candidates.length) break;
    plan = candidates[0];
  }
  return { plans: [plan], examined, limited };
}

/** Extend a conversion route with ingredient branches when doing so reduces
 * external dependencies. All branch costs and source consumption are included.
 * This bounded search reports its limits rather than claiming global optimality.
 */
export async function findAutoPlans(
  options: PlannerOptions,
  recipesFor: (id: string) => Promise<Recipe[]>,
  interrupted: () => boolean = () => false,
  budget = 5000,
  onProgress?: (result: PlannerResult) => void,
): Promise<PlannerResult> {
  const cache = new Map<string, Promise<Recipe[]>>();
  const lookup = (id: string) => {
    if (!cache.has(id)) cache.set(id, recipesFor(id));
    return cache.get(id)!;
  };
  const breadth = Math.max(1, budget / 5000);
  const machineCache = new Map<Recipe, ReturnType<typeof plannerMachine>>();
  const primaryDeadline = Date.now() + Math.min(120000, 8000 * breadth);
  const primary = await findRoutes(
    { ...options, maxSuggestions: Math.min(2000, Math.min(100, options.maxSuggestions * 5) * breadth) },
    lookup,
    () => interrupted() || Date.now() > primaryDeadline,
    Math.max(1, Math.floor(budget / 2)),
    false,
    machineCache,
  );
  let examined = primary.examined;
  let limited = primary.limited;
  const plans: PlannerPlan[] = [];
  const planKeys = new Set<string>();
  const accepted = new Map<string, PlannerPlan>();
  const eligibility = new WeakMap<PlannerPlan, boolean>();
  const bannedIds = new Set(options.bannedNeededItemIds ?? []);
  const startupCache = new WeakMap<PlannerPlan, ReturnType<typeof plannerStartupMaterials>>();
  const startup = (plan: PlannerPlan) => {
    let value = startupCache.get(plan);
    if (!value) { value = plannerStartupMaterials(plan, bannedIds); startupCache.set(plan, value); }
    return value;
  };
  const eligible = (plan: PlannerPlan) => {
    const cached = eligibility.get(plan);
    if (cached !== undefined) return cached;
    let valid = options.maxTotalEu === undefined || plannerNormalizedTotalEu(plan, options.targetId) <= options.maxTotalEu;
    if (valid && options.bannedNeededItemIds?.length) {
      const { summary } = plannerComparisonSummary(plan, options.targetId);
      valid = startup(plan).missing.size === 0 && !summary.inputs.some(flow => options.bannedNeededItemIds!.includes(flow.item.id) && !summary.recursiveInputIds.includes(flow.item.id));
    }
    eligibility.set(plan, valid);
    return valid;
  };
  const report = (plan: PlannerPlan) => {
    plan = reuseByproducts(plan);
    if (accepted.has(plan.key) || options.excludedPlans.includes(plan.key) || !eligible(plan)) return;
    accepted.set(plan.key, plan);
    const ranked = [...accepted.values()].sort((a, b) => comparePlans(options, a, b)).slice(0, options.maxSuggestions);
    accepted.clear();
    for (const candidate of ranked) accepted.set(candidate.key, candidate);
    onProgress?.({ plans: ranked, examined, limited: true });
  };
  for (const plan of primary.plans) { if (interrupted()) break; report(plan); }
  const branchBudget = Math.max(primary.examined, Math.floor(budget * 0.8));
  // Estimate the remaining production depth for banned inputs. Immediate ban
  // counts alone favor cheap container conversions and hide shorter real chains.
  const productionDependencies = new Map<string, string[][]>();
  for (const id of bannedIds) {
    if (interrupted()) break;
    const dependencies: string[][] = [];
    for (const recipe of await lookup(id)) {
      await yieldSearchWork();
      if (interrupted()) break;
      if (options.excludedRecipes.includes(recipe.id) || isContainerConversion(recipe)) continue;
      if (!machineCache.has(recipe)) machineCache.set(recipe, plannerMachine(recipe, options));
      if (!machineCache.get(recipe)) continue;
      dependencies.push([...new Set(recipe.ingredients.filter(i => i.direction === 'input' && i.consumed && i.amount > 0 && bannedIds.has(i.itemId)).map(i => i.itemId))]);
    }
    productionDependencies.set(id, dependencies);
  }
  const productionDepth = new Map([...bannedIds].map(id => [id, Infinity]));
  for (let pass = 0; pass < bannedIds.size; pass++) {
    for (const [id, alternatives] of productionDependencies) {
      for (const dependencies of alternatives) {
        const depth = 1 + dependencies.reduce((sum, input) => sum + (productionDepth.get(input) ?? 0), 0);
        if (depth < productionDepth.get(id)!) productionDepth.set(id, depth);
      }
    }
  }
  // Keep alternative ingredient branches alive: the cheapest immediate branch
  // can lead to an impossible banned dependency several recipes later.
  type PendingPlan = { original: PlannerPlan; plan: PlannerPlan; attempted: Set<string>; optional: boolean; repetition?: number };
  const optionalPlans: PendingPlan[] = [];
  const banCounts = new WeakMap<PlannerPlan, number>();
  const untimedCounts = new WeakMap<PlannerPlan, number>();
  const untimedSteps = (plan: PlannerPlan) => {
    let count = untimedCounts.get(plan);
    if (count === undefined) {
      count = plan.steps.filter(step => !hasRecipeTiming(step.recipe)).length;
      untimedCounts.set(plan, count);
    }
    return count;
  };
  const outstandingBans = (plan: PlannerPlan) => {
    const cached = banCounts.get(plan);
    if (cached !== undefined) return cached;
    const produced = startup(plan).available;
    const count = plan.supplies.filter(supply => bannedIds.has(supply.item.id) && !produced.has(supply.item.id))
      .reduce((sum, supply) => sum + Math.min(1000, productionDepth.get(supply.item.id) ?? 1000), 0);
    banCounts.set(plan, count);
    return count;
  };
  // Untimed crafting cannot supply a rate in the diagram summary. Expanding
  // its cheap conversions first can exhaust the budget on routes that final
  // validation rejects. Keep them as fallbacks, after timed production paths.
  const compareRequiredBranches = (a: PlannerPlan, b: PlannerPlan) =>
    untimedSteps(a) - untimedSteps(b) ||
    a.steps.length + outstandingBans(a) - b.steps.length - outstandingBans(b) ||
    outstandingBans(a) - outstandingBans(b);
  const pendingPlans = new PriorityQueue<PendingPlan>((a, b) => bannedIds.size
    ? (a.repetition ?? 0) - (b.repetition ?? 0) || compareRequiredBranches(a.plan, b.plan) || a.plan.steps.length - b.plan.steps.length : 0);
  const materialStates = new Map<string, number>();
  const requiredBranches = new Map<string, PlannerResult>();
  const enqueue = (state: PendingPlan) => {
    // Explore distinct material paths before more machine/recipe variants of
    // the same path. Retain every variant so ranking and exclusions still apply.
    const produced = startup(state.plan).available;
    const missing = state.plan.supplies.filter(s => bannedIds.has(s.item.id) && !produced.has(s.item.id)).map(s => s.item.id).sort();
    const key = JSON.stringify([state.plan.steps.length, [...produced].sort(), missing, [...state.attempted].sort()]);
    const repetition = materialStates.get(key) ?? 0;
    materialStates.set(key, repetition + 1);
    pendingPlans.push({ ...state, repetition });
  };
  for (const original of primary.plans) enqueue({ original, plan: reuseByproducts(original), attempted: new Set(), optional: false });
  let expanded = 0;
  while ((pendingPlans.length || optionalPlans.length) && expanded++ < budget) {
    await yieldSearchWork();
    if (interrupted()) { limited = true; break; }
    const state = (pendingPlans.shift() ?? optionalPlans.shift())!;
    const { original } = state;
    let plan = state.plan;
    const attempted = new Set(state.attempted);
    while ((options.bannedNeededItemIds?.length || options.inputIds?.length || options.inputId || Object.keys(options.inputFactors ?? {}).length) && plan.steps.length < options.maxSteps) {
      // Bans prohibit entirely external supplies, not partially supplied ones.
      // A byproduct can satisfy that rule without adding another producer.
      const produced = startup(plan).available;
      const pending = plan.supplies.filter(supply => bannedIds.has(supply.item.id)
        ? !produced.has(supply.item.id) : !attempted.has(supply.item.id));
      // Resolve hard bans across all alternatives before spending the bounded
      // search on optional improvements to other external inputs.
      const supply = options.bannedNeededItemIds?.length
        // Complex dependencies can provide simpler ones as byproducts.
        ? pending.filter(supply => bannedIds.has(supply.item.id)).sort((a, b) =>
          (productionDepth.get(b.item.id) ?? 0) - (productionDepth.get(a.item.id) ?? 0))[0] ?? (state.optional ? pending[0] : undefined)
        : pending[0];
      if (!supply || interrupted() || examined >= branchBudget) break;
      const mustProduce = options.bannedNeededItemIds?.includes(supply.item.id) ?? false;
      attempted.add(supply.item.id);
      const cachedBranch = mustProduce ? requiredBranches.get(supply.item.id) : undefined;
      const loaded = cachedBranch ?? await findRoutes(
        {
          ...options,
          targetId: supply.item.id,
          targetAmounts: undefined,
          maxSteps: options.maxSteps - plan.steps.length,
          maxSuggestions: mustProduce ? Math.ceil(400 * breadth) : Math.min(2000, 10 * breadth),
          excludedRecipes: [
            ...options.excludedRecipes,
            ...(mustProduce ? [] : plan.steps.map((step) => step.recipe.id)),
          ],
          excludedPlans: [],
        },
        lookup,
        interrupted,
        Math.min(400 * breadth, branchBudget - examined),
        mustProduce,
        machineCache,
      );
      // Required searches enumerate direct producers. Cache only complete
      // searches; exclude recipes already in this particular plan afterwards.
      if (mustProduce && !cachedBranch && !loaded.limited) requiredBranches.set(supply.item.id, loaded);
      const sub = mustProduce ? { ...loaded, plans: loaded.plans.filter(branch => !branch.steps.some(step => plan.steps.some(existing => existing.recipe.id === step.recipe.id))) } : loaded;
      examined += cachedBranch ? 0 : sub.examined;
      limited ||= sub.limited;
      const alternatives = sub.plans
        .map((branch): PlannerPlan => {
          const offset = plan.steps.length;
          const supplies = new Map(
            plan.supplies
              .filter((value) => value.item.id !== supply.item.id)
              .map((value) => [value.item.id, { ...value }]),
          );
          for (const extra of branch.supplies) {
            const amount = extra.amount * supply.amount;
            supplies.set(extra.item.id, {
              item: extra.item,
              amount: amount + (supplies.get(extra.item.id)?.amount ?? 0),
            });
          }
          const suppliedPorts = new Set(
            plan.links.map((link) => `${link.target}:${link.targetSlot}`),
          );
          const links = [
            ...plan.links,
            ...branch.links.map((link) => ({
              ...link,
              source: link.source + offset,
              target: link.target + offset,
            })),
          ];
          plan.steps.forEach((step, target) =>
            stepIngredients(step).forEach((ingredient) => {
              if (
                ingredient.direction === "input" &&
                ingredient.consumed &&
                ingredient.amount > 0 &&
                ingredient.itemId === supply.item.id &&
                !suppliedPorts.has(`${target}:${ingredient.slot}`)
              ) {
                links.push({
                  source: offset + branch.steps.length - 1,
                  sourceSlot: branch.steps.at(-1)!.outputSlot,
                  target,
                  targetSlot: ingredient.slot,
                });
              }
            }),
          );
          return {
            key: `${plan.key}+[${branch.key}]`,
            targetOutputId: plan.targetOutputId,
            balanceMachines: plan.balanceMachines,
            steps: [
              ...plan.steps,
              ...branch.steps.map((step) => ({
                ...step,
                cycles: step.cycles * supply.amount,
              })),
            ],
            links,
            totalEu: plan.totalEu + branch.totalEu * supply.amount,
            inputAmount: plan.inputAmount + branch.inputAmount * supply.amount,
            outputPerBatch: plan.outputPerBatch,
            supplies: [...supplies.values()],
          };
        })
        .filter(
          (candidate) => mustProduce || compareDependencies(options, candidate, plan) < 0,
        );
      alternatives.sort((a, b) => (mustProduce ? compareRequiredBranches(a, b) : 0) || comparePlans(options, a, b));
      if (mustProduce) {
        for (const alternative of alternatives) {
          if (pendingPlans.length >= Math.min(budget, 20000)) { limited = true; break; }
          enqueue({ original, plan: alternative, attempted: new Set(attempted), optional: false });
        }
        // Reconsider every branch globally after one required ingredient.
        // Greedily completing the first branch starves shorter alternatives.
        break;
      }
      if (alternatives[0]) plan = alternatives[0];
    }
    if (!state.optional && options.bannedNeededItemIds?.length && !interrupted() && examined < branchBudget) {
      const { summary } = plannerComparisonSummary(plan, options.targetId);
      if (startup(plan).missing.size === 0 && !summary.inputs.some(flow => options.bannedNeededItemIds!.includes(flow.item.id) && !summary.recursiveInputIds.includes(flow.item.id))) {
        if (optionalPlans.length < 20000) optionalPlans.push({ original, plan, attempted: new Set(attempted), optional: true });
        else limited = true;
      }
    }
    // Keep the unbranched alternative too: dismissing a plan must not suppress
    // another valid configuration using the same target recipe.
    for (const candidate of [plan, original])
      if (
        !options.excludedPlans.includes(candidate.key) &&
        !planKeys.has(candidate.key)
      )
        { plans.push(candidate); planKeys.add(candidate.key); report(candidate); }
    // A full batch of valid required-dependency routes is ready. Additional
    // variants can improve ranking, but should not delay usable suggestions.
    if (bannedIds.size && accepted.size >= options.maxSuggestions)
      return { plans: [...accepted.values()], examined, limited: true };
  }
  limited ||= pendingPlans.length > 0 || optionalPlans.length > 0;
  if (!interrupted()) plans.sort((a, b) => comparePlans(options, a, b));
  // Check the most complete plans first and reserve work for recycling rather
  // than spending the entire search on alternative source-to-target paths.
  for (const plan of [...plans]) {
    if (interrupted() || examined >= budget) break;
    const recovered = await recoverByproducts(plan, options, lookup, interrupted, Math.min(400 * breadth, budget - examined));
    examined += recovered.examined; limited ||= recovered.limited;
    for (const candidate of recovered.plans)
      if (candidate !== plan && !planKeys.has(candidate.key)) { plans.push(candidate); planKeys.add(candidate.key); report(candidate); }
  }
  limited ||= interrupted() || examined >= budget;
  return { plans: [...accepted.values()], examined, limited };
}
