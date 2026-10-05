import fs from 'node:fs';
import { createRequire } from 'node:module';
import { gameRecipeLayout, gameSlotPositions } from '../lib/game-recipe-layout';

type Slot = { id: string; x: number; y: number; amount: number };
type Handler = { name: string; id: string; class: string; recipeCount?: number; error?: string; enumerationFailures?: string[]; slotShapes?: { index: number; inputs: Slot[]; outputs: Slot[]; other: Slot[] }[] };
const handlers: Handler[] = JSON.parse(fs.readFileSync('data/extraction/instance/minecraft/dumps/planner/handler-coverage.json', 'utf8'));
const Database = createRequire(import.meta.url)('better-sqlite3');
const db = new Database('data/catalogs/gtnh-2.8.4.sqlite', { readonly: true });
const counts = new Map(db.prepare('SELECT handler,count(*) count FROM Recipe WHERE enabled=1 GROUP BY handler').all().map((r: any) => [r.handler,r.count]));
const nativeHandlers = new Set(db.prepare("SELECT DISTINCT json_extract(layout,'$.neiHandlerId') id FROM Recipe WHERE json_extract(layout,'$.information')=1").all().map((r:any)=>r.id));
const report = handlers.map(h => {
  const layout = gameRecipeLayout(h.name);
  const mismatches: object[] = [];
  let checked = 0;
  const nativeOverlaps = (h.slotShapes ?? []).some(shape => {
    const slots = [...shape.outputs,...shape.other];
    return slots.some((a,i) => slots.slice(i+1).some(b=>Math.abs(a.x-b.x)<16 && Math.abs(a.y-b.y)<16));
  });
  if (layout && h.class === 'gregtech.nei.GTNEIDefaultHandler') {
    for (const shape of h.slotShapes ?? []) for (const direction of ['input','output'] as const) for (const kind of ['item','fluid'] as const) {
      const key = `${kind}${direction === 'input' ? 'Inputs' : 'Outputs'}` as const;
      const special = (s: Slot) => h.name === 'Circuit Assembly Line' && s.amount === 0 && s.x === 120 && s.y === 52;
      const slots = (direction === 'input' ? shape.inputs : [...shape.outputs,...shape.other]).filter(s => !special(s) && s.id.startsWith('gregtech:gt.GregTech_FluidDisplay') === (kind === 'fluid'));
      const capacity = Math.max(layout.counts[key], slots.length);
      const rows = Math.max(1,Math.ceil(Math.max(layout.counts.itemInputs,layout.counts.itemOutputs,shape.inputs.filter(s=>!special(s)&&!s.id.startsWith('gregtech:gt.GregTech_FluidDisplay')).length,[...shape.outputs,...shape.other].filter(s=>!s.id.startsWith('gregtech:gt.GregTech_FluidDisplay')).length)/3));
      const expected = gameSlotPositions(capacity, direction, kind, layout.frontend, rows);
      layout.positions?.[key]?.forEach((position,index)=>{if(index<expected.length)expected[index]=position;});
      for (const slot of slots) {
        checked++;
        // NEI's (-5,-11) translation plus the one-pixel item inset.
        if (!expected.some(p => p.x === slot.x + 4 && p.y === slot.y + 10)) mismatches.push({ sample: shape.index, direction, kind, actual: { x: slot.x + 4, y: slot.y + 10 }, expected });
      }
    }
  }
  return { name: h.name, id: h.id, class: h.class, runtimeRecipes: h.recipeCount ?? 0, catalogRecipes: counts.get(h.name) ?? 0, slotShapes: h.slotShapes?.length ?? 0, checkedSlots: checked, mismatches,
    status: h.name === 'Circuit Assembly Line Imprinting' ? 'excluded-by-request' : h.error ? 'export-error' : !(h.recipeCount ?? 0) ? 'requires-item-query-or-empty' : !counts.has(h.name) ? 'missing-from-catalog' : nativeHandlers.has(h.id) ? 'native-reference-capture' : checked ? mismatches.length ? nativeOverlaps ? 'native-overlap-kept-readable' : 'slot-layout-mismatch' : 'slot-coordinates-verified' : 'visual-review-required',
    note: mismatches.length && nativeOverlaps ? 'Native overflow outputs overlap; the planner retains nonoverlapping output rows.' : undefined,
    error: h.error, enumerationFailures: h.enumerationFailures };
});
fs.mkdirSync('data/research/runtime-discovery', { recursive:true });
fs.writeFileSync('data/research/runtime-discovery/coverage.json', JSON.stringify(report,null,2));
const totals: Record<string,number> = {};
for (const h of report) totals[h.status] = (totals[h.status] ?? 0)+1;
console.log(totals);
console.log('Layout discrepancies:',report.filter(h=>h.mismatches.length).map(h=>({name:h.name,mismatches:h.mismatches.length,first:h.mismatches[0]})));
console.log('Missing populated handlers:',report.filter(h=>h.status==='missing-from-catalog').map(h=>({name:h.name,count:h.runtimeRecipes})));
db.close();
