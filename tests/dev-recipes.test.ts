import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../app/api/dev-recipes/route';
import { catalog } from '../lib/db';
after(() => catalog.$disconnect());

test('developer browser lists all catalog types and returns one recipe per page', async () => {
  const previous = process.env.NODE_ENV;
  Object.assign(process.env, { NODE_ENV: 'development' });
  try {
    const response = await GET(new Request('http://localhost/api/dev-recipes'));
    assert.equal(response.status, 200);
    const types: { name: string; count: number }[] = await response.json();
    const actual = await catalog.recipe.groupBy({ by: ['handler'], where: { NOT: { handler: 'Circuit Assembly Line Imprinting' } } });
    assert(!types.some(type => type.name === 'Circuit Assembly Line Imprinting'));
    assert.deepEqual(new Set(types.map(type => type.name)), new Set(actual.map(type => type.handler)));
    const type = types.find(type => type.count > 1)!;
    const page = await GET(new Request(`http://localhost/api/dev-recipes?handler=${encodeURIComponent(type.name)}&page=1`));
    const result = await page.json();
    assert.equal(result.page, 1);
    assert.equal(result.total, type.count);
    assert.equal(result.recipes.length, 1);
    assert.equal(result.recipes[0].handler, type.name);
    const searched = await GET(new Request('http://localhost/api/dev-recipes?q=Blast%20Furnace'));
    const matches = await searched.json();
    assert(matches.some((entry: { name: string }) => entry.name === 'Blast Furnace'));
    assert(matches.every((entry: { icon: unknown }) => 'icon' in entry));
    const blast = await GET(new Request('http://localhost/api/dev-recipes?handler=Blast%20Furnace&q=Blast%20Furnace'));
    const blastResult = await blast.json();
    assert(blastResult.recipes[0].craftingMachines.length > 0);
    const empty = await GET(new Request('http://localhost/api/dev-recipes?q=nonexistent-recipe-xyz-123'));
    assert.deepEqual(await empty.json(), []);
  } finally { if (previous === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV'); else Object.assign(process.env, { NODE_ENV: previous }); }
});

test('developer recipe endpoint is unavailable in production', async () => {
  const previous = process.env.NODE_ENV;
  Object.assign(process.env, { NODE_ENV: 'production' });
  try { assert.equal((await GET(new Request('http://localhost/api/dev-recipes'))).status, 404); }
  finally { if (previous === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV'); else Object.assign(process.env, { NODE_ENV: previous }); }
});
