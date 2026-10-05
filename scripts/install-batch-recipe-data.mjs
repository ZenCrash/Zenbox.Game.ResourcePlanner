import fs from 'node:fs';
import Database from 'better-sqlite3';
const db=new Database('data/catalogs/gtnh-2.8.4.sqlite');db.pragma('foreign_keys=ON');
const root='data/extraction/instance/minecraft/dumps/planner';const rows=JSON.parse(fs.readFileSync(root+'/batch-layouts.json'));const item=db.prepare('SELECT * FROM Item WHERE id=?');const ins=db.prepare('SELECT * FROM Ingredient WHERE recipeId=? ORDER BY slot');const update=db.prepare('UPDATE Recipe SET layout=?,details=? WHERE id=?');const report={matched:{},unmatched:[]};
const rawItems=new Map(JSON.parse(fs.readFileSync(root+'/batch-items.json')).map(i=>[i.id,i]));
function known(id){return item.get(id);}
function alternatives(r){return [...new Set([r.id,...(r.alternatives??[]).map(i=>i.id)])];}
function add(rid,r,direction,slot,chance=1,consumed=true){if(!known(r.id))throw Error('Missing item '+r.id);const variants=alternatives(r).filter(known);const result=db.prepare('INSERT INTO Ingredient(recipeId,itemId,direction,slot,amount,chance,consumed,x,y,alternatives) VALUES (?,?,?,?,?,?,?,?,?,?)').run(rid,r.id,direction,slot,r.amount,chance,+consumed,r.x??null,r.y??null,JSON.stringify(variants));for(const id of variants)db.prepare('INSERT OR IGNORE INTO IngredientVariant(ingredientId,itemId) VALUES (?,?)').run(result.lastInsertRowid,id);}
function present(r,i){return alternatives(r).includes(i.itemId);}
function display(raw){if(!raw)return;const existing=known(raw.id);if(existing)return existing;const base=db.prepare('SELECT * FROM Item WHERE registryId=? AND metadata=? LIMIT 1').get(raw.registryId,raw.metadata);if(!base)return;return {...base,id:raw.id,name:raw.name,tooltip:JSON.stringify(raw.tooltip.split('<br>'))};}
db.transaction(()=>{
for(const recipe of db.prepare('SELECT * FROM Recipe').all()){
 const source=rows.filter(r=>r.handler===recipe.handler);if(!source.length)continue;
 const ingredients=ins.all(recipe.id),input=ingredients.filter(i=>i.direction==='input'),output=ingredients.filter(i=>i.direction==='output'&&known(i.itemId)?.kind!=='fluid');
 const candidates=source.filter(r=>{
  if(recipe.handler==='Alloy Smelter' && r.class.includes('enderio') && input.some(i=>i.x===null))return false;
  const outs=[...r.outputs,...r.other].filter(i=>!i.id.startsWith('gregtech:gt.GregTech_FluidDisplay'));
  if(recipe.handler==='Alchemic Calcinator')return [...input,...output].some(i=>r.outputs.some(o=>present(o,i)));
  if(output.length&&!output.every(i=>outs.some(o=>present(o,i))))return false;
  const significant=input.filter(i=>known(i.itemId)?.kind!=='fluid');
  return significant.every(i=>r.inputs.some(a=>present(a,i))) && (!r.fields.mRecipe || r.fields.mRecipe.mDuration===recipe.durationTicks);
 });
 const r=candidates[0];if(!r){report.unmatched.push([recipe.handler,recipe.id]);continue;}
 let layout=JSON.parse(recipe.layout),details=JSON.parse(recipe.details);layout.batchFields={};
 const machine = {'Acclimatiser':'Genetics:labMachine:4','Analyzer':'Genetics:labMachine:1','Alchemic Calcinator':'AWWayofTime:blockAlchemicCalcinator','Animal Trap Drops':'harvestcraft:animaltrap'}[recipe.handler];
 if(machine)layout.machineIds=[machine];
 if(r.fields.mRecipe?.mSpecialItems)layout.specialItem=display(r.fields.mRecipe.mSpecialItems);
 if(recipe.handler==='Alloy Smelter'&&r.class.includes('enderio')){layout.batchLayout='ender-alloy';layout.batchFields.energy=r.fields.energy;layout.machineIds=['EnderIO:blockAlloySmelter'];}
 if(['Acclimatiser','Analyzer','Animal Trap Drops','Binding Ritual','Decayables','Alchemic Calcinator'].includes(recipe.handler)){
 layout.batchLayout={'Acclimatiser':'acclimatiser','Analyzer':'analyzer','Animal Trap Drops':'animal-trap','Binding Ritual':'binding','Decayables':'decayables','Alchemic Calcinator':'calcinator'}[recipe.handler];
 if(recipe.handler==='Animal Trap Drops'){db.prepare("DELETE FROM Ingredient WHERE recipeId=? AND direction='output'").run(recipe.id);r.other.forEach((o,n)=>add(recipe.id,o,'output',n,r.fields.chances[n]/100));details=details.filter(s=>!s.startsWith('Additional handler slots'));}
 if(recipe.handler==='Decayables'){layout.batchFields.time=r.fields.time;layout.machineIds=['miscutils:blockDecayablesChest'];}
 if(recipe.handler==='Binding Ritual'){layout.machineIds=['AWWayofTime:masterStone'];layout.batchFields.ritualIcon=known('AWWayofTime:activationCrystal')?.image;layout.batchFields.reagentIcon=db.prepare("SELECT image FROM Item WHERE registryId LIKE '%reagentConduit%' OR registryId LIKE '%ReagentConduit%' LIMIT 1").get()?.image;}
 if(recipe.handler==='Alchemic Calcinator'){
 const reagent=r.fields.reagent;layout.batchFields={amount:r.fields.amount,name:reagent.name,color:'#'+[reagent.colourRed,reagent.colourGreen,reagent.colourBlue].map(v=>v.toString(16).padStart(2,'0')).join('')};
 db.prepare('DELETE FROM Ingredient WHERE recipeId=?').run(recipe.id);r.outputs.forEach((i,n)=>add(recipe.id,i,'input',n));r.inputs.forEach((i,n)=>add(recipe.id,i,'input',n+r.outputs.length,1,false));
 const id='reagent:'+reagent.name;db.prepare('INSERT OR IGNORE INTO Item(id,registryId,metadata,name,mod,"group",tooltip,image,hidden,sortOrder,kind) VALUES (?,?,0,?,\'Blood Magic\',\'Reagents\',?,NULL,1,0,\'reagent\')').run(id,id,reagent.name,JSON.stringify([reagent.name,'Alchemic reagent (AR)']));add(recipe.id,{id,amount:r.fields.amount},'output',0);
 }
 }
 if(recipe.handler==='Baryonic Perfection')for(const raw of r.inputs.filter(i=>!i.id.startsWith('gregtech:gt.GregTech_FluidDisplay')))if(!input.some(i=>present(raw,i)))add(recipe.id,raw,'input',input.length+raw.x);
 if(recipe.handler==='Dissolution Tank')details=details.map(s=>s.startsWith('Special value:')?'Ratio: '+s.split(':')[1].trim()+':1':s);
 if(recipe.handler==='Draconic Evolution Fusion ...')details=details.map(s=>s.startsWith('Special value:')?'Tier Casing: '+s.split(':')[1].trim():s);
 update.run(JSON.stringify(layout),JSON.stringify(details),recipe.id);report.matched[recipe.handler]=(report.matched[recipe.handler]??0)+1;
}
db.prepare("UPDATE Recipe SET enabled=0 WHERE handler='Circuit Assembly Line Imprinting'").run();
})();
fs.writeFileSync('data/catalogs/gtnh-2.8.4.batch-layout-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({matched:report.matched,unmatched:report.unmatched.length}));db.close();
