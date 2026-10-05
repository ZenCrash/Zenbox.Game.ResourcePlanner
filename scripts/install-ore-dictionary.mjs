// Run the isolated exporter with planner-export.ores-only first.
// Forge membership uses registry ID and metadata (32767 means any subtype).
import { readFile, writeFile } from 'node:fs/promises';
const source = 'data/extraction/instance/minecraft/dumps/planner/ore-dictionary.json';
const raw = JSON.parse(await readFile(source, 'utf8'));
const groups = Object.fromEntries(Object.entries(raw).sort(([a], [b]) => a.localeCompare(b)).map(([name, members]) => {
  if (!Array.isArray(members) || members.some(entry => !Array.isArray(entry) || typeof entry[0] !== 'string' || !Number.isInteger(entry[1]))) throw new Error(`Invalid ore group: ${name}`);
  return [name, [...new Map(members.map(entry => [JSON.stringify(entry), entry])).values()]];
}).filter(([, members]) => members.length > 0));
await writeFile('lib/gtnh-ore-dictionary.json', JSON.stringify(groups) + '\n');
console.log(`Installed ${Object.keys(groups).length} GTNH 2.8.4 ore dictionary groups.`);
