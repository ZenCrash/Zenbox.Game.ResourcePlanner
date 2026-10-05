import { z } from 'zod';
import { catalog } from '@/lib/db';
import { isGtnhInstalled } from '@/lib/game-packs';
import dictionary from '@/lib/gtnh-ore-dictionary.json';
import { oreDictionaryPeers, type OreDictionary } from '@/lib/ore-dictionary';

export async function POST(request: Request) {
  if (!isGtnhInstalled()) return Response.json({ error: 'Install the GTNH game pack first.' }, { status: 409 });
  const parsed = z.string().min(1).max(500).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Invalid item ID.' }, { status: 400 });
  const selected = await catalog.item.findUnique({ where: { id: parsed.data } });
  if (!selected) return Response.json({ error: 'Item not found.' }, { status: 404 });
  const ores = dictionary as unknown as OreDictionary;
  const peers = oreDictionaryPeers(ores, selected);
  const registries = [...new Set(peers.groups.flatMap(group => ores[group].map(([id]) => id)))];
  const items = new Map([[selected.id, selected]]);
  for (let start = 0; start < registries.length; start += 200) {
    const candidates = await catalog.item.findMany({ where: { registryId: { in: registries.slice(start, start + 200) } } });
    for (const item of candidates) if (peers.matches(item)) items.set(item.id, item);
  }
  const allItems = [...items.values()];
  const groupItemIds = Object.fromEntries(peers.groups.map(group => {
    const membership = oreDictionaryPeers({ [group]: ores[group] }, selected);
    return [group, allItems.filter(item => membership.matches(item)).map(item => item.id)];
  }));
  return Response.json({ groups: peers.groups, groupItemIds, items: allItems });
}
