import type { PlannerResult } from './auto-planner';
import { defaultPlannerSearchDuration } from './planner-search-settings';

export const PLANNER_SEARCH_TIMEOUT_MS = defaultPlannerSearchDuration * 1000;

/** Widen incomplete empty searches; suggestion count and duration are ceilings. */
export async function searchPlannerUntilDeadline(
  run: (budget: number, interrupted: () => boolean) => Promise<PlannerResult>,
  { aborted = () => false, now = Date.now, timeoutMs = PLANNER_SEARCH_TIMEOUT_MS, maxSuggestions }: {
    aborted?: () => boolean; now?: () => number; timeoutMs?: number; maxSuggestions: number;
  },
): Promise<PlannerResult> {
  const deadline = now() + timeoutMs;
  const interrupted = () => aborted() || now() >= deadline;
  let best: PlannerResult = { plans: [], examined: 0, limited: false };
  let examined = 0;
  for (let budget = 5000; !interrupted(); budget *= 2) {
    const result = await run(budget, interrupted);
    examined += result.examined;
    if (result.plans.length >= best.plans.length) best = result;
    if (!result.limited || result.plans.length > 0) return { ...result, plans: result.plans.slice(0, maxSuggestions), examined };
    // Let disconnect/cancel events run between attempts, including cached ones.
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return { ...best, examined, limited: true };
}
