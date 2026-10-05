export const plannerPriorityIds = ["eu", "output", "yield", "singleblock", "netFuel"] as const;
export type PlannerPriority = typeof plannerPriorityIds[number];
export const plannerPriorityLabels: Record<PlannerPriority, string> = {
  netFuel: 'Net fuel value',
  eu: "Cheapest total EU per target output",
  output: "Most output",
  yield: "Most output from input",
  singleblock: "Singleblocks over multiblocks",
};
export function prioritiesForTarget(values: PlannerPriority[], fuel: boolean): PlannerPriority[] {
  return fuel ? values.includes('netFuel') ? values : ['netFuel', ...values] : values.filter(value => value !== 'netFuel');
}
export function validPlannerPriorities(values: PlannerPriority[]) {
  return new Set(values).size === values.length && ['eu', 'output', 'yield', 'singleblock'].every(id => values.includes(id as PlannerPriority));
}
export function defaultPlannerPriorities(first: "eu" | "output" | "yield" = "eu"): PlannerPriority[] {
  return [...new Set<PlannerPriority>([first, "eu", "output", "yield", "singleblock"])];
}
