import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { catalog } from '../lib/db';
import { POST } from '../app/api/auto-planner/route';
import { plannerComparisonSummary } from '../lib/planner-balance';
import type { PlannerResult } from '../lib/auto-planner';
after(() => catalog.$disconnect());
for (const expanded of [false, true]) test(`EV seed oil cell routes resolve all ${expanded ? 64 : 37} screenshot bans within ten steps`, async (t) => {
  const names = ['Tetranitromethane', 'Tetranitromethane Cell', 'Ethanol', 'Ethenone', 'Ethenone Cell', 'Methanol', 'Nitric Acid Cell', 'Tiny Pile of Sodium Hydroxide Dust', 'Acetone', 'Methanol Cell', 'Nitrogen Dioxide Cell', 'Sodium Hydroxide Dust', 'Acetic Acid', 'Ethanol Cell', 'Nitrogen Dioxide', 'Salt Water', 'Sulfuric Acid', 'Acetone Cell', 'Nitric Acid', 'Sodium Methoxide Dust', 'Carbon Monoxide', 'Ethylene Cell', 'Fuel', 'Hydrochloric Acid Cell', 'Nether Air', 'Tiny Pile of Sodium Methoxide Dust', 'Carbon Dioxide Cell', 'Carbon Monoxide Cell', 'Diesel Cell', 'Nitric Oxide Cell', 'Small Pile of Sodium Methoxide Dust', 'Nitric Oxide', 'Ammonium Chloride', 'Platinum Concentrate Cell', 'Sodium Hydride Dust', 'Sulfuric Acid Cell', 'Trimethyl Borate'];
  if (expanded) names.push('Bucket of Nitric Acid', 'Cellulose Fiber', 'Small Pile of Sodium Hydroxide Dust', 'Spray Can Solvent', 'Ammonia', 'Brine', 'Calcium Acetate Solution', 'MTBE Reaction Mixture (Butene)', 'Calcium Acetate Solution Cell', 'Gallium Hydroxide Dust', 'MTBE Reaction Mixture (Butane)', 'Sodium Dust', 'Hydrogen', 'Nitrogen', 'Oxygen', 'Nether Semifluid', 'Sodium Aluminate Dust', 'Wood Vinegar', 'Diluted Acetone', 'Fermented Biomass', 'Pollution', 'Salt Water Cell', 'Acetic Acid Cell', 'Carbon Dioxide', 'Hydrogen Cell', 'Sodium Nitrate Dust', 'Waste Liquid');
  const banned = await Promise.all(names.map(name => catalog.item.findFirstOrThrow({ where: { name, ...(name === 'Sodium Nitrate Dust' ? { id: 'miscutils:itemDustSodiumNitrate' } : {}) }, orderBy: { kind: 'asc' } })));
  const input = await catalog.item.findFirstOrThrow({ where: { name: 'Seed Oil Cell' } });
  const target = await catalog.item.findFirstOrThrow({ where: { name: 'Cetane-Boosted Diesel Cell' } });
  const bannedNeededItemIds = banned.map(item => item.id);
  assert.equal(new Set(bannedNeededItemIds).size, expanded ? 64 : 37);
  const response = await POST(new Request('http://localhost/api/auto-planner', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targetId: target.id, inputIds: [input.id], priority: 'eu', priorities: ['netFuel', 'eu', 'output', 'yield', 'singleblock'], allowMultiblocks: true, maxTier: 4, maxSteps: 10, maxSuggestions: 100, searchDurationSeconds: 30, bannedNeededItemIds }) }));
  const result: PlannerResult = await response.json();
  assert(result.plans.length > 0, JSON.stringify({ examined: result.examined, limited: result.limited }));
  t.diagnostic(`${result.plans.length} valid suggestions; ${result.examined} candidates examined`);
  for (const plan of result.plans) {
    assert(plan.steps.length <= 10);
    plan.steps.forEach((step, index) => {
      if (step.recipe.handler === 'Fluid Canner' || step.recipe.handler === 'Bottler')
        assert(plan.links.some(link => link.target === index), 'Container conversion must have an upstream producer');
    });
    const { summary } = plannerComparisonSummary(plan, target.id);
    assert(!summary.inputs.some(flow => bannedNeededItemIds.includes(flow.item.id) && !summary.recursiveInputIds.includes(flow.item.id)));
  }
});
