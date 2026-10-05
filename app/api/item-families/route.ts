import { z } from 'zod';
import { catalog } from '@/lib/db';
import { fluidLookupAmounts } from '@/lib/fluid-containers';
import { isGtnhInstalled } from '@/lib/game-packs';

export async function POST(request: Request) {
  if (!isGtnhInstalled()) return Response.json({ error: 'Install the GTNH game pack first.' }, { status: 409 });
  const parsed = z.array(z.string().min(1).max(500)).max(200).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'Invalid item IDs.' }, { status: 400 });
  const families: Record<string, string[]> = {};
  for (const id of new Set(parsed.data)) {
    if (families[id]) continue;
    const ids = Object.keys(await fluidLookupAmounts(id));
    for (const member of ids) families[member] = ids;
  }
  const ids = Object.keys(families);
  const items = [];
  for (let start = 0; start < ids.length; start += 300)
    items.push(...await catalog.item.findMany({ where: { id: { in: ids.slice(start, start + 300) } } }));
  return Response.json({ families, items });
}
