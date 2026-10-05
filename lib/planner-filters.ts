import { z } from "zod";
import { machineTiers } from "./machine-selection";
import { plannerPriorityIds, validPlannerPriorities } from "./planner-priorities";
import { defaultPlannerSearchDuration } from './planner-search-settings';

export const plannerFiltersKey = "resource-planner:auto-planner-filters:v1";
const item = z.object({
  id: z.string(),
  name: z.string(),
  registryId: z.string(),
  metadata: z.number(),
  mod: z.string(),
  group: z.string(),
  tooltip: z.string(),
  image: z.string().nullable(),
  kind: z.string(),
});
const count = z
  .string()
  .refine(
    (value) =>
      /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 100,
  )
  .catch("10");
const filters = z.object({
  target: item.optional().catch(undefined),
  input: item.optional().catch(undefined),
  inputs: z.array(item).max(100).optional().catch(undefined),
  priority: z.enum(["eu", "yield", "output"]).catch("eu"),
  priorities: z.array(z.enum(plannerPriorityIds)).min(4).max(5).refine(validPlannerPriorities).optional().catch(undefined),
  allowMultiblocks: z.boolean().catch(false),
  balanceMachines: z.boolean().catch(true),
  maxTotalEu: z.string().refine(value => value.trim() === '' || (Number.isFinite(Number(value)) && Number(value) >= 0)).catch(''),
  maxTier: z
    .number()
    .int()
    .min(0)
    .max(machineTiers.length - 1)
    .catch(1),
  maxSteps: count,
  maxSuggestions: count,
  searchDurationSeconds: z.unknown().transform(() => defaultPlannerSearchDuration).default(defaultPlannerSearchDuration),
  bannedMachineIds: z.array(z.string()).max(10000).catch([]),
  bannedNeededItems: z.array(item).max(10000).catch([]),
  bannedNeededOreGroups: z.record(z.string(), z.array(z.string())).catch({}),
  recipeTypes: z.array(z.string()).max(1000).catch([]),
});
export function parsePlannerFilters(value: unknown) {
  const parsed = filters.parse(value && typeof value === "object" ? value : {});
  const inputIds = new Set((parsed.inputs ?? (parsed.input ? [parsed.input] : [])).map(item => item.id));
  return { ...parsed, bannedNeededItems: parsed.bannedNeededItems.filter(item => !inputIds.has(item.id)) };
}
export function readPlannerFilters() {
  try {
    return parsePlannerFilters(
      JSON.parse(sessionStorage.getItem(plannerFiltersKey) ?? "null"),
    );
  } catch {
    return parsePlannerFilters(null);
  }
}
