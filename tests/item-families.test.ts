import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../app/api/item-families/route';
import { catalog } from '../lib/db';
after(() => catalog.$disconnect());
test('fluid families include cells and other containers without merging unrelated items', async () => {
  const response = await POST(new Request('http://localhost/api/item-families', { method: 'POST', body: JSON.stringify(['fluid:bioethanol', 'minecraft:stone']) }));
  assert.equal(response.status, 200);
  const { families, items } = await response.json();
  const ids = families['fluid:bioethanol'];
  assert(ids.includes('gregtech:gt.metaitem.01:30706'));
  assert(ids.includes('Forestry:bucketEthanol'));
  assert(!ids.includes('fluid:methanol'));
  assert(!ids.includes('minecraft:bucket'));
  assert.deepEqual(families['gregtech:gt.metaitem.01:30706'], ids);
  assert.deepEqual(families['minecraft:stone'], ['minecraft:stone']);
  assert(ids.every((id: string) => items.some((item: { id: string }) => item.id === id)));
});
