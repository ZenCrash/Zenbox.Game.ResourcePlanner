import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plannerGroupNode } from '../lib/planner-group';
import { summaryRecipe } from '../lib/area-summary';
import type { PlannedGraph } from '../components/auto-recipe-planner';

const graph = (): PlannedGraph => ({ group: { title: 'Diesel' }, edges: [], nodes: [0, 1].map(i => ({
  id: String(i), type: 'recipe', position: { x: i * 860, y: i * 70 }, measured: { width: 700, height: 450 },
  data: { recipe: summaryRecipe, machines: 1, variants: {} },
})) });

test('transparent wizard group encloses recipes with room above the header', () => {
  const g = graph(), group = plannerGroupNode(g)!;
  assert.equal(group.data.theme, 'transparent');
  for (const node of g.nodes) {
    assert(group.position.x < node.position.x);
    assert(group.position.x + group.width > node.position.x + node.measured!.width!);
    assert(group.position.y + group.height > node.position.y + node.measured!.height!);
  }
  g.group!.headerHeight = 300;
  const enlarged = plannerGroupNode(g)!;
  assert(enlarged.position.y + 300 < 0);
  assert(enlarged.position.y < group.position.y);
  assert.equal(enlarged.position.y + enlarged.height, group.position.y + group.height);
  assert.deepEqual(g.nodes.map(n => n.position), [{ x: 0, y: 0 }, { x: 860, y: 70 }]);
});

test('removed, nested, and single-step suggestions have no group', () => {
  const g = graph();
  assert.equal(plannerGroupNode({ ...g, group: undefined }), undefined);
  assert.equal(plannerGroupNode({ ...g, nodes: g.nodes.slice(0, 1) }), undefined);
  assert.equal(plannerGroupNode({ nodes: g.nodes, edges: [] }), undefined);
});

test('initial preview bounds include group header and routing outside the cards', async () => {
  const { plannerPreviewBounds } = await import('../lib/planner-preview-bounds');
  const g = graph();
  g.group!.headerHeight = 300;
  g.edges = [{ id: 'route', source: '0', target: '1', data: { waypoints: [{ x: -200, y: 900 }] } }];
  const bounds = plannerPreviewBounds(g)!;
  const group = plannerGroupNode(g)!;
  assert.equal(bounds.x, -200);
  assert.equal(bounds.y, group.position.y);
  assert.equal(bounds.y + bounds.height, 900);
  const nested = plannerPreviewBounds({ ...g, group: undefined })!;
  assert.equal(nested.y, 0);
  assert.equal(nested.x, -200);
  assert.equal(nested.height, 900);
  assert.equal(plannerPreviewBounds({ ...g, nodes: g.nodes.map(n => ({ ...n, measured: undefined })) }), undefined);
});

test('fit viewport contains the complete measured group even in a small preview', async () => {
  const { getViewportForBounds } = await import('@xyflow/react');
  const { plannerPreviewBounds } = await import('../lib/planner-preview-bounds');
  const g = graph();
  g.group!.headerHeight = 650;
  const bounds = plannerPreviewBounds(g)!;
  for (const [width, height] of [[600, 300], [350, 220]]) {
    const viewport = getViewportForBounds(bounds, width, height, .001, 1, .15);
    assert(bounds.x * viewport.zoom + viewport.x >= 0);
    assert(bounds.y * viewport.zoom + viewport.y >= 0);
    assert((bounds.x + bounds.width) * viewport.zoom + viewport.x <= width);
    assert((bounds.y + bounds.height) * viewport.zoom + viewport.y <= height);
    assert(viewport.zoom < 1);
  }
});

test('wizard defaults to only normalized net fuel for fuels and total EU for other targets', async () => {
  const { plannerDefaultCalculators } = await import('../lib/planner-calculators');
  const { TOTAL_EU_INPUT_ID, NORMALIZED_NET_FUEL_EU_OUTPUT_ID } = await import('../lib/summary-rate');
  const target = { id: 'fuel', name: 'Fuel', kind: 'fluid', registryId: 'fuel', metadata: 0, mod: '', group: '', tooltip: '[]', image: null };
  const fluid = plannerDefaultCalculators(target, true);
  assert.deepEqual(fluid.map(c => [c.inputId, c.outputId, c.side, c.value]), [
    ['fuel', NORMALIZED_NET_FUEL_EU_OUTPUT_ID, 'input', '1000'],
  ]);
  assert.equal(plannerDefaultCalculators({ ...target, kind: 'item' }, false)[0].value, '1');
  assert.deepEqual(plannerDefaultCalculators({ ...target, kind: 'item' }, true).map(c => [c.outputId, c.value]), [[NORMALIZED_NET_FUEL_EU_OUTPUT_ID, '1']]);
  assert.deepEqual(plannerDefaultCalculators(target, false).map(c => [c.inputId, c.value]), [[TOTAL_EU_INPUT_ID, '1000']]);
});
