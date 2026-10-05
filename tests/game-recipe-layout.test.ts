import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gameRecipeLayout, gameRecipeGeometry, gameSlotPositions } from '../lib/game-recipe-layout';
import definitions from '../lib/game-recipe-layouts.json';
import batchDefinitions from '../lib/batch-game-recipe-layouts.json';
import type { Ingredient } from '../lib/model';

test('standard machines retain game capacity, spacing, and fluid separation', () => {
  const layout = gameRecipeLayout('Chemical Bath')!;
  assert.equal(layout.texture, 'bath');
  const geometry = gameRecipeGeometry(layout, []);
  assert.deepEqual(geometry.slots.filter(s=>s.kind==='item' && s.direction==='input').map(s=>[s.x,s.y]), [[34,24],[52,24]]);
  assert.deepEqual(geometry.slots.filter(s=>s.kind==='fluid' && s.direction==='input').map(s=>[s.x,s.y]), [[34,62],[52,62]]);
  assert.equal(geometry.slots.length,9);
  assert.deepEqual(gameSlotPositions(4,'output','item','RecipeMapFrontend',2),[{x:106,y:15},{x:124,y:15},{x:106,y:33},{x:124,y:33}]);
});

test('fluid-only fusion uses the central item row, large multiblocks use stacked grids', () => {
  const fusion = gameRecipeGeometry(gameRecipeLayout('Fusion Reactor')!, []);
  assert.deepEqual(fusion.slots.map(s=>[s.x,s.y]), [[34,24],[52,24],[106,24]]);
  const large = gameRecipeGeometry(gameRecipeLayout('Multiblock Centrifuge')!, []);
  assert.equal(large.slots.length,24);
  assert.deepEqual(large.slots.filter(s=>s.kind==='fluid' && s.direction==='input').map(s=>[s.x,s.y]),[[16,44],[34,44],[52,44],[16,62],[34,62],[52,62]]);
});

test('overlay direction and fluid flags match the game, and decorations are retained', () => {
  const washer = gameRecipeLayout('Ore Washer')!;
  assert.deepEqual(washer.overlays.itemInputs,['crushed_ore']);
  assert.deepEqual(washer.overlays.itemOutputs,['dust','dust','dust']);
  assert.deepEqual(washer.overlays.fluidInputs,[null]);
  assert.deepEqual(gameRecipeLayout('Lathe')!.decorations,[{x:98,y:24,width:5,height:18,texture:'lathe_base'}]);
  assert.equal(gameRecipeLayout('Forge Hammer')!.decorations[0].texture,'hammer_base');
});

test('every imported map has assets, nonoverlapping slots, and bounds containing its content', () => {
  for (const [name,definition] of Object.entries({...definitions.layouts, ...batchDefinitions})) {
    const geometry = gameRecipeGeometry(definition,[]);
    const positions = geometry.slots.map(s=>`${s.x},${s.y}`);
    assert.equal(new Set(positions).size,positions.length,name);
    for(const slot of geometry.slots) {
      assert.ok((slot.x - 16 + 18) * 2 <= geometry.width,name);
      assert.ok((slot.y - 6 + 18) * 2 <= geometry.height,name);
      if(slot.overlay) assert.ok(fs.existsSync(`public/ui/faithful/slot-${slot.overlay}.png`),`${name}: ${slot.overlay}`);
    }
    assert.ok(fs.existsSync(`public/ui/faithful/${definition.texture}.png`),name);
    for(const decoration of definition.decorations) assert.ok(fs.existsSync(`public/ui/faithful/${decoration.texture}.png`),name);
  }
});

test('extra ingredients are never dropped, unknown custom handlers retain fallback', () => {
  const ingredients=Array.from({length:3},(_,slot)=>({slot,direction:'input',item:{kind:'item'}} as Ingredient));
  const geometry=gameRecipeGeometry(gameRecipeLayout('Extractor')!,ingredients);
  assert.equal(geometry.slots.filter(s=>s.ingredient).length,3);
  assert.equal(gameRecipeLayout('Unknown mod machine'),undefined);
});
