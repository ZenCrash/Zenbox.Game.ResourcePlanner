import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLANNER_SEARCH_TIMEOUT_MS, searchPlannerUntilDeadline } from '../lib/planner-search';
import type { PlannerPlan } from '../lib/auto-planner';
import { parsePlannerFilters } from '../lib/planner-filters';

test('search duration is fixed at one minute, including previously saved choices', () => {
  assert.equal(parsePlannerFilters({}).searchDurationSeconds, 60);
  for (const seconds of [30, 60, 120, 300, 600, 90]) assert.equal(parsePlannerFilters({ searchDurationSeconds: seconds }).searchDurationSeconds, 60);
  for (const count of ['1', '100']) assert.equal(parsePlannerFilters({ maxSuggestions: count }).maxSuggestions, count);
  for (const count of ['0', '101', '1.5']) assert.equal(parsePlannerFilters({ maxSuggestions: count }).maxSuggestions, '10');
});

test('restored selected inputs are removed from needed bans without removing other forms', () => {
  const fluid = { id: 'fluid:fuel', name: 'Fuel', kind: 'fluid', registryId: '', metadata: 0, mod: '', group: '', tooltip: '[]', image: null };
  const cell = { ...fluid, id: 'fuel-cell', kind: 'item' };
  const restored = parsePlannerFilters({ inputs: [fluid], bannedNeededItems: [fluid, cell] });
  assert.deepEqual(restored.bannedNeededItems.map(item => item.id), ['fuel-cell']);
});

test('selected duration is used as the search deadline', async () => {
  let now = 0;
  let calls = 0;
  await searchPlannerUntilDeadline(async () => {
    calls++;
    now += 15000;
    return { plans: [], examined: 1, limited: true };
  }, { now: () => now, timeoutMs: 30000, maxSuggestions: 1 });
  assert.equal(calls, 2);
});

const plan = { key: 'found' } as PlannerPlan;
test('incomplete searches widen their work budget until enough suggestions are found', async () => {
  const budgets: number[] = [];
  const result = await searchPlannerUntilDeadline(async budget => {
    budgets.push(budget);
    return { plans: budget >= 20000 ? [plan] : [], examined: budget, limited: true };
  }, { maxSuggestions: 1 });
  assert.deepEqual(budgets, [5000, 10000, 20000]);
  assert.deepEqual(result.plans, [plan]);
  assert.equal(result.examined, 35000);
});

test('one-minute deadline stops an empty search from widening further', async () => {
  assert.equal(PLANNER_SEARCH_TIMEOUT_MS, 60000);
  let now = 0;
  let calls = 0;
  const result = await searchPlannerUntilDeadline(async (_budget, interrupted) => {
    calls++;
    now += 30000;
    assert.equal(interrupted(), calls === 2);
    return { plans: [], examined: 10, limited: true };
  }, { now: () => now, maxSuggestions: 2 });
  assert.equal(calls, 2);
  assert.deepEqual(result.plans, []);
  assert(result.limited);
});

test('maximum suggestions is a ceiling, not a quota that prolongs a successful search', async () => {
  let calls = 0;
  const result = await searchPlannerUntilDeadline(async () => {
    calls++;
    return { plans: [plan], examined: 5000, limited: true };
  }, { timeoutMs: 600000, maxSuggestions: 100 });
  assert.equal(calls, 1);
  assert.deepEqual(result.plans, [plan]);
});

test('cancellation interrupts the active attempt and prevents another attempt', async () => {
  let aborted = false;
  let calls = 0;
  const result = await searchPlannerUntilDeadline(async (_budget, interrupted) => {
    calls++;
    aborted = true;
    assert(interrupted());
    return { plans: [], examined: 1, limited: true };
  }, { aborted: () => aborted, maxSuggestions: 1 });
  assert.equal(calls, 1);
  assert(result.limited);
});

test('exhausted searches finish early even if fewer suggestions exist', async () => {
  let calls = 0;
  const result = await searchPlannerUntilDeadline(async () => {
    calls++;
    return { plans: [], examined: 1, limited: false };
  }, { maxSuggestions: 100 });
  assert.equal(calls, 1);
  assert.equal(result.limited, false);
});
