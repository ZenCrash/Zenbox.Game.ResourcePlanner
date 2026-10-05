import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../app/api/item-ore-groups/route';
import { catalog } from '../lib/db';
after(() => catalog.$disconnect());
const request = (id: unknown) => POST(new Request('http://localhost/api/item-ore-groups', { method: 'POST', body: JSON.stringify(id) }));

test('actual ore dictionary lookup includes other logs and the selected log', async () => {
  const response = await request('minecraft:log');
  assert.equal(response.status, 200);
  const { groups, groupItemIds, items } = await response.json();
  assert(groups.includes('logWood'));
  assert(groupItemIds.logWood.includes('minecraft:log'));
  assert(groupItemIds.logWood.includes('minecraft:log:1'));
  assert(items.some((item: { id: string }) => item.id === 'minecraft:log'));
  assert(items.some((item: { id: string }) => item.id === 'minecraft:log:1'));
  assert(!items.some((item: { id: string }) => item.id === 'minecraft:diamond'));
  assert.equal(new Set(items.map((item: { id: string }) => item.id)).size, items.length);
});
test('fluid lookup does not invent ore groups from container families', async () => {
  const response = await request('fluid:bioethanol');
  const { groups, items } = await response.json();
  assert.deepEqual(groups, []);
  assert.deepEqual(items.map((item: { id: string }) => item.id), ['fluid:bioethanol']);
});
test('individual ore groups retain their own membership while all groups include their union', async () => {
  const response = await request('minecraft:iron_ingot');
  const { groups, groupItemIds, items } = await response.json();
  assert(groups.includes('ingotIron'));
  assert(groups.includes('ingotAnyIron'));
  assert(groupItemIds.ingotIron.includes('minecraft:iron_ingot'));
  assert(groupItemIds.ingotAnyIron.some((id: string) => !groupItemIds.ingotIron.includes(id)));
  const union = new Set(Object.values(groupItemIds).flat());
  assert.deepEqual(new Set(items.map((item: { id: string }) => item.id)), union);
});
test('invalid or missing item IDs are rejected', async () => {
  assert.equal((await request([])).status, 400);
  assert.equal((await request('missing:item')).status, 404);
});
