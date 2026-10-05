import definitions from './game-recipe-layouts.json';
import batchDefinitions from './batch-game-recipe-layouts.json';
import type { Ingredient } from './model';
import { recipeSlotGroups, type RecipeSlotCounts } from './recipe-slots';

export type GameRecipeLayout = {
  id: string;
  frontend: string;
  counts: RecipeSlotCounts;
  texture: string;
  decorations: { x: number; y: number; width: number; height: number; texture: string }[];
  overlays: Partial<Record<keyof RecipeSlotCounts, (string | null)[]>>;
  positions?: Partial<Record<keyof RecipeSlotCounts, { x: number; y: number }[]>>;
};
const layouts: Record<string, GameRecipeLayout> = { ...definitions.layouts, ...batchDefinitions };
export function gameRecipeLayout(handler: string): GameRecipeLayout | undefined {
  return layouts[handler];
}

// Port of GTNH UIHelper, LargeNEIFrontend and FluidOnlyFrontend coordinates.
// Coordinates are game GUI pixels; the recipe renderer displays them at 2x.
export function gameSlotPositions(count: number, direction: 'input' | 'output', kind: 'item' | 'fluid', frontend: string, itemRows: number) {
  const output = direction === 'output';
  if (frontend === 'LargeNEIFrontend') {
    return grid(count, output ? 106 : 16, 8 + (kind === 'fluid' ? itemRows * 18 : 0), 3);
  }
  if (kind === 'fluid' && frontend !== 'FluidOnlyFrontend') {
    return grid(count, output ? 106 : Math.max(16, 70 - count * 18), 62, Math.max(1, count));
  }
  const columns = count < 4 ? Math.max(1, count) : count === 4 ? 2 : 3;
  const x = output ? 106 : count === 1 ? 52 : count === 2 || count === 4 ? 34 : 16;
  const y = count <= 3 ? 24 : count <= 6 ? 15 : 6;
  return grid(count, x, y, columns);
}
function grid(count: number, x: number, y: number, columns: number) {
  return Array.from({ length: count }, (_, i) => ({ x: x + (i % columns) * 18, y: y + Math.floor(i / columns) * 18 }));
}

export function gameRecipeGeometry(layout: GameRecipeLayout, ingredients: Ingredient[]) {
  const groups = (['input', 'output'] as const).flatMap(direction =>
    recipeSlotGroups(ingredients, direction, layout.counts).map(group => ({...group, direction})),
  );
  const itemRows = Math.max(1, ...groups.filter(g => g.kind === 'item').map(g => Math.ceil(g.slots.length / 3)));
  const slots = groups.flatMap(({kind,direction,slots}) => {
    const key = `${kind}${direction === 'input' ? 'Inputs' : 'Outputs'}` as keyof RecipeSlotCounts;
    const positions = gameSlotPositions(slots.length, direction, kind, layout.frontend, itemRows);
    layout.positions?.[key]?.forEach((position, index) => { if (index < positions.length) positions[index] = position; });
    return slots.map((ingredient,index) => ({ingredient, kind, direction, index, ...positions[index], overlay: layout.overlays[key]?.[index] ?? null}));
  });
  // Keep the game's standard margins and center spacing; grow for larger maps.
  const width = Math.max(144, ...slots.map(s => s.x + 18 - 16)) * 2;
  const height = Math.max(42, ...slots.map(s => s.y + 18), ...layout.decorations.map(d => d.y+d.height)) * 2 - 12;
  return { slots, width, height };
}
