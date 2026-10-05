import { catalog } from "./db";

// GregTech expands its own NEI searches using unification and familiar prefixes.
// These links must never become planner substitutions or affect other mods.
export async function neiAssociatedRecipeIds(item: string, uses: boolean) {
  const tables = await catalog.$queryRaw<{ name: string }[]>`
    SELECT name FROM sqlite_master WHERE type='table'
    AND name IN ('RuntimeLookupAlias', 'RuntimeLookupHandler', 'RuntimeInformationItem')
  `;
  const names = new Set(tables.map(t => t.name));
  const ids: string[] = [];
  if (names.has("RuntimeLookupAlias") && names.has("RuntimeLookupHandler")) {
    const matches = await catalog.$queryRaw<{ recipeId: string }[]>`
      SELECT DISTINCT i.recipeId FROM RuntimeLookupAlias a
      JOIN Ingredient i ON i.itemId=a.target AND i.direction=${uses ? "input" : "output"}
      JOIN Recipe r ON r.id=i.recipeId
      JOIN RuntimeLookupHandler h ON h.handler=r.handler
      WHERE a.item=${item} AND a.mode=${uses ? "uses" : "recipes"}
        AND r.enabled=1 AND json_extract(r.layout, '$.slotCounts') IS NOT NULL
      UNION
      SELECT DISTINCT i.recipeId FROM RuntimeLookupAlias a
      JOIN IngredientVariant v ON v.itemId=a.target
      JOIN Ingredient i ON i.id=v.ingredientId AND i.direction=${uses ? "input" : "output"}
      JOIN Recipe r ON r.id=i.recipeId
      JOIN RuntimeLookupHandler h ON h.handler=r.handler
      WHERE a.item=${item} AND a.mode=${uses ? "uses" : "recipes"}
        AND r.enabled=1 AND json_extract(r.layout, '$.slotCounts') IS NOT NULL
    `;
    ids.push(...matches.map(r => r.recipeId));
  }
  if (names.has("RuntimeInformationItem")) {
    const pages = await catalog.$queryRaw<{ recipeId: string }[]>`
      SELECT recipeId FROM RuntimeInformationItem WHERE item=${item} AND mode=${uses ? "uses" : "recipes"}
    `;
    ids.push(...pages.map(r => r.recipeId));
  }
  return [...new Set(ids)];
}
