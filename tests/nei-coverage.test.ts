import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../app/api/recipes/route';
import { catalog } from '../lib/db';
import { neiAssociatedRecipeIds } from '../lib/nei-associated-recipes';
import { gameRecipeGeometry, gameRecipeLayout } from '../lib/game-recipe-layout';
import type { Recipe } from '../lib/model';
after(() => catalog.$disconnect());

test('iron ingot recipe lookup includes native nugget byproducts from electromagnetic separation', async () => {
  const response = await GET(new Request('http://localhost/api/recipes?item=minecraft%3Airon_ingot'));
  assert.equal(response.status, 200);
  const recipes: Recipe[] = await response.json();
  const separators = recipes.filter(r => r.handler === 'Electromagnetic Separator');
  const native = await catalog.recipe.findMany({ where: { enabled: true, handler: 'Electromagnetic Separator', ingredients: { some: { direction: 'output', itemId: 'gregtech:gt.metaitem.01:9032' } } }, select: { id: true } });
  assert(native.length > 0);
  assert.deepEqual(new Set(separators.map(r => r.id)),new Set(native.map(r => r.id)));
  assert(separators.every(r => r.ingredients.some(i => i.item.name === 'Iron Nugget' && i.direction === 'output')));
  // The result keeps its actual products; it does not invent iron-ingot output.
  assert(separators.every(r => !r.ingredients.some(i => i.itemId === 'minecraft:iron_ingot' && i.direction === 'output')));
});

test('GT familiar prefixes do not merge all iron forms or unrelated crafting handlers', async () => {
  const aliases = await catalog.$queryRaw<{ target: string }[]>`SELECT target FROM RuntimeLookupAlias WHERE item='minecraft:iron_ingot' AND mode='recipes'`;
  assert.deepEqual(aliases.map(a => a.target), ['gregtech:gt.metaitem.01:9032']);
  const ids = await neiAssociatedRecipeIds('minecraft:iron_ingot', true);
  const recipes = await catalog.recipe.findMany({ where: { id: { in: ids } } });
  assert(!recipes.some(r => r.handler === 'Shaped Crafting' || r.handler === 'Shapeless Crafting'));
});

for (const handler of ['GregTech Ore Processing','GregTech Material Tools','Tool Materials','GregTech Circuits','GregTech Lenses','GregTech Material Parts']) {
  test(`${handler} contains native reference pages without production ingredients`, async () => {
    const page = await catalog.recipe.findFirstOrThrow({ where: { handler, enabled: true }, include: { ingredients: true } });
    const layout = JSON.parse(page.layout);
    assert.equal(layout.information, true);
    assert(layout.informationImage.startsWith('/assets/gtnh-2.8.4/'));
    assert(layout.width > 0 && layout.height > 0);
    assert.equal(page.ingredients.length, 0);
    assert.equal(page.durationTicks, 0);
  });
}

test('rechecked Dehydrator and Heliothermal positions use native frontend coordinates', () => {
  const dehydrator = gameRecipeGeometry(gameRecipeLayout('Multiblock Dehydrator')!,[]);
  assert(dehydrator.slots.filter(s => s.kind === 'item').every(s => [8,26,44].includes(s.y)));
  const plasma = gameRecipeGeometry(gameRecipeLayout('Heliothermal Plasma Fabric...')!,[]);
  assert.equal(plasma.slots.find(s => s.kind === 'item' && s.direction === 'input')?.y,33);
});
