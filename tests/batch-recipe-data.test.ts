import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { catalog } from '../lib/db';
after(() => catalog.$disconnect());

test('calcinator recipes consume powder, retain the orb, and produce an AR reagent', async () => {
  const recipes = await catalog.recipe.findMany({where:{handler:'Alchemic Calcinator'},include:{ingredients:{include:{item:true}}}});
  assert.equal(recipes.length,15);
  const names = new Set<string>();
  for(const recipe of recipes){
    const metadata=JSON.parse(recipe.layout); names.add(metadata.batchFields.name);
    assert.equal(metadata.batchFields.amount,1000);
    assert(recipe.ingredients.some(i=>i.direction==='input' && i.consumed));
    assert(recipe.ingredients.some(i=>i.direction==='input' && !i.consumed));
    assert(recipe.ingredients.some(i=>i.direction==='output' && i.item.kind==='reagent' && i.amount===1000));
  }
  for(const name of ['virtus','aquasalus','crystallos','praesidium'])assert(names.has(name),name);
});

test('RF alloy recipes remain separate from GregTech and imprinting is disabled',async()=>{
  const recipes=await catalog.recipe.findMany({where:{handler:'Alloy Smelter'}});
  const rf=recipes.filter(r=>JSON.parse(r.layout).batchLayout==='ender-alloy');
  assert.equal(rf.length,11);
  assert(rf.every(r=>JSON.parse(r.layout).batchFields.energy>0));
  assert.equal(await catalog.recipe.count({where:{handler:'Circuit Assembly Line Imprinting',enabled:true}}),0);
});

test('animal trap outputs preserve probabilities and dissolution ratios are labeled',async()=>{
  const traps=await catalog.recipe.findMany({where:{handler:'Animal Trap Drops'},include:{ingredients:true}});
  assert.equal(traps.length,3);
  for(const recipe of traps){
    const outputs=recipe.ingredients.filter(i=>i.direction==='output');
    assert(outputs.length>1);
    assert(Math.abs(outputs.reduce((sum,i)=>sum+i.chance,0)-1)<0.001);
  }
  const tanks=await catalog.recipe.findMany({where:{handler:'Dissolution Tank'}});
  assert(tanks.some(r=>JSON.parse(r.details).includes('Ratio: 9:1')));
  assert(tanks.some(r=>JSON.parse(r.details).includes('Ratio: 10:1')));
});
