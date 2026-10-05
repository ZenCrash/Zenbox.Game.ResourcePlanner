import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import sharp from 'sharp';

const root = 'data/extraction/instance/minecraft/dumps/planner';
const read = name => JSON.parse(fs.readFileSync(`${root}/${name}.json`, 'utf8'));
const handlers = read('handler-coverage'), aliases = read('lookup-associations');
const pages = read('information-pages'), discovery = read('discovery');
const db = new Database('data/catalogs/gtnh-2.8.4.sqlite');
const items = new Map(db.prepare('SELECT * FROM Item').all().map(i => [i.id, i]));
const assets = 'data/game-assets/gtnh-2.8.4/items';
fs.mkdirSync(assets, { recursive: true });
const prepared = [];
const report = { aliases: 0, pages: {}, rejectedPages: [], unknownAliasTargets: 0 };
for (const page of pages) {
  if (page.hiddenEmpty) continue;
  if (!page.image || page.renderError) { report.rejectedPages.push({ handler: page.handler, error: page.renderError }); continue; }
  const bytes = fs.readFileSync(path.join(root, 'information-images', path.basename(page.image)));
  const pixels = await sharp(bytes).ensureAlpha().raw().toBuffer();
  if (!pixels.some((v, i) => i % 4 === 3 && v > 0)) { report.rejectedPages.push({ handler: page.handler, error: 'Blank capture' }); continue; }
  const digest = createHash('sha256').update(bytes).digest('hex');
  fs.writeFileSync(`${assets}/${digest}.png`, bytes);
  // Custom Diagram's Point is the icon centre (Draw.drawItem subtracts eight).
  const components = (page.components ?? []).map(c => ({ ...c, x: c.x - 8, y: c.y - 8, item: items.get(c.item?.id) })).filter(c => c.item);
  const slots = ['inputs', 'outputs', 'other'].flatMap(side => (page[side] ?? []).map(s => ({ x: s.x, y: s.y, item: items.get(s.id), side, alternatives: (s.alternatives ?? []).map(a=>a.id).filter(id=>items.has(id)) }))).filter(s => s.item);
  const members = [...new Set([...components, ...slots].map(c => c.item.id))];
  const sourceHandler = discovery.handlers.find(h => h.id === page.handlerId);
  const tab = page.tabItem?.id ?? sourceHandler?.tabItem?.id;
  const machineIds = [...new Set((sourceHandler?.machines ?? []).map(i=>i.id).filter(id=>items.has(id)))];
  const layout = { information: true, neiHandlerId: page.handlerId, referenceOnly: !!page.referenceOnly, informationImage: `/assets/gtnh-2.8.4/items/${digest}.png`, width: page.width, height: page.height, components: page.capturedItems ? [...components,...slots] : components, informationSlots: page.capturedItems ? [] : slots, machineIds, tabItemId: tab, tabIcon: items.get(tab)?.image };
  const name = `${page.handler} — ${[...new Set([...components, ...slots].map(c => c.item.name))].join(', ')}`;
  // Pixel-identical NBT variants can have different lookup identities.
  const identity = [page.handlerId,digest,page.components?.map(c=>[c.item?.id,c.description]),page.inputs,page.outputs,page.other];
  const id = 'nei-information:' + createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  const links = page.referenceOnly
    ? slots.flatMap(s => [...new Set([s.item.id,...s.alternatives])].map(item=>({ item, mode: s.side === 'inputs' ? 'uses' : 'recipes' })))
    : members.flatMap(item => ['recipes','uses'].map(mode => ({ item, mode })));
  prepared.push({ id, name, handler: page.handler, layout: JSON.stringify(layout), links });
}
db.exec(`CREATE TABLE IF NOT EXISTS RuntimeLookupAlias (item TEXT NOT NULL, mode TEXT NOT NULL, target TEXT NOT NULL, PRIMARY KEY(item, mode, target));
CREATE TABLE IF NOT EXISTS RuntimeLookupHandler (handler TEXT PRIMARY KEY);
`);
db.transaction(() => {
  db.exec('DELETE FROM RuntimeLookupAlias; DELETE FROM RuntimeLookupHandler; DROP TABLE IF EXISTS RuntimeInformationItem; CREATE TABLE RuntimeInformationItem (item TEXT NOT NULL, mode TEXT NOT NULL, recipeId TEXT NOT NULL, PRIMARY KEY(item, mode, recipeId));');
  // No Ingredient rows are created: these are information pages, not production.
  db.prepare("DELETE FROM Recipe WHERE id LIKE 'nei-information:%'").run();
  const aliasInsert = db.prepare('INSERT OR IGNORE INTO RuntimeLookupAlias VALUES(?,?,?)');
  for (const row of aliases) if (items.has(row.item)) for (const mode of ['recipes', 'uses']) for (const target of row[mode]) {
    if (target === row.item) continue;
    if (items.has(target)) report.aliases += aliasInsert.run(row.item, mode, target).changes;
    else report.unknownAliasTargets++;
  }
  const handlerInsert = db.prepare('INSERT OR IGNORE INTO RuntimeLookupHandler VALUES(?)');
  for (const h of handlers) if (h.class === 'gregtech.nei.GTNEIDefaultHandler') handlerInsert.run(h.name);
  const insert = db.prepare('INSERT OR IGNORE INTO Recipe(id,name,handler,durationTicks,euPerTick,enabled,layout,details) VALUES(?,?,?,0,0,1,?,?)');
  const link = db.prepare('INSERT OR IGNORE INTO RuntimeInformationItem VALUES(?,?,?)');
  for (const page of prepared) {
    const added = insert.run(page.id, page.name, page.handler, page.layout, '[]').changes;
    for (const member of page.links) link.run(member.item, member.mode, page.id);
    report.pages[page.handler] = (report.pages[page.handler] ?? 0) + added;
  }
})();
fs.writeFileSync('data/catalogs/gtnh-2.8.4.nei-coverage-report.json', JSON.stringify(report, null, 2));
console.log(report);
db.close();
