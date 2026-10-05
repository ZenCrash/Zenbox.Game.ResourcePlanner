import { catalog } from '@/lib/db';
import { isGtnhInstalled } from '@/lib/game-packs';
import { hydrateRecipeVariants } from '@/lib/recipe-data';
import { compareRecipeHandlers } from '@/lib/recipe-order';
import { recipeTabIcon } from '@/lib/model';

export async function GET(request: Request) {
  if (process.env.NODE_ENV !== 'development') return new Response(null, { status: 404 });
  if (!isGtnhInstalled()) return Response.json({ error: 'Install the GTNH game pack first.' }, { status: 409 });
  const params = new URL(request.url).searchParams;
  const handler = params.get('handler');
  const query = (params.get('q') ?? '').trim().slice(0, 200);
  const search = { NOT: { handler: 'Circuit Assembly Line Imprinting' }, ...(query ? { OR: [{ handler: { contains: query } }, { name: { contains: query } }, { ingredients: { some: { item: { name: { contains: query } } } } }] } : {}) };
  if (handler === null) {
    const types = await catalog.recipe.groupBy({ by: ['handler'], where: search, _count: { _all: true }, _min: { id: true } });
    const icons = new Map<string, string | null>();
    for (let start = 0; start < types.length; start += 200) {
      const samples = await catalog.recipe.findMany({ where: { id: { in: types.slice(start, start + 200).flatMap(type => type._min.id ? [type._min.id] : []) } }, include: { ingredients: { include: { item: true } } } });
      for (const sample of samples) icons.set(sample.handler, recipeTabIcon(sample));
    }
    return Response.json(types.map(type => ({ name: type.handler, count: type._count._all, icon: icons.get(type.handler) })).sort((a, b) => compareRecipeHandlers(a.name, b.name)));
  }
  const where = { handler, ...search };
  const total = await catalog.recipe.count({ where });
  const requested = Number(params.get('page'));
  const page = Math.max(0, Math.min(total - 1, Number.isFinite(requested) ? Math.floor(requested) : 0));
  const recipes = await catalog.recipe.findMany({ where, orderBy: { id: 'asc' }, skip: page, take: 1, include: { ingredients: { orderBy: { slot: 'asc' }, include: { item: true } } } });
  return Response.json({ recipes: await hydrateRecipeVariants(recipes), page, total });
}
