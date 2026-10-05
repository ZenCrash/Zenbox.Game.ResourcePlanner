# Runtime recipe and asset discovery

The installed GTNH 2.8.4 instance is the source of truth. Read it only; all game execution and exports belong in `data/extraction/instance/minecraft`, protected by the exporter's path check and `planner-export.enabled` marker.

## Repeatable capture

1. `node scripts/prepare-runtime-discovery.mjs both` selects Faithful in the isolated copy, preserves other export triggers as timestamped files, and requests exact item/NBT renders below 64 pixels. Use `discovery` for metadata only, `images` for item images, or `blocks` for 256px blocks plus registered fluids.
2. Compile `tools/gtnh-export-bootstrap/PlannerExport.java` with `scripts/build-export-bootstrap.mjs` (set `PLANNER_JAVAC` to a JDK javac), then run `scripts/launch-extraction.mjs` with the PrismLauncher root.
3. Wait for the isolated export status to finish. Inspect `discovery-errors.json`, per-handler `error`/`renderError`, and `repair-errors.json` before installing.
4. Run `node scripts/install-runtime-discovery.mjs`, `node scripts/audit-runtime-textures.mjs`, and, after a completed 64px render, `node scripts/install-faithful-runtime-images.mjs`.

The image installer retains old content-addressed files, backs up the SQLite catalog, skips blank renders, and updates embedded recipe images as well as item images. The separate `blocks` pass refreshes existing 256px block renders and fluid display stacks; install it with `node scripts/install-faithful-runtime-images.mjs --blocks`. Higher pixel dimensions alone do not create more texture detail: Faithful's native sprite resolution remains the limit for flat items.

## Evidence

- `dumps/planner/discovery.json`: active packs, runtime handler classes, dimensions, Y shifts, first-recipe positions, registered machines, tab items/sprites, Forge fluid-container relationships, and per-handler capture failures.
- `dumps/planner/discovery-backgrounds`: direct background captures; only successful captures are listed. These are references, not automatically interchangeable layouts. Handler-specific code can draw additional dynamic elements or need an actual recipe screen.
- `data/research/runtime-discovery/faithful-textures.json`: native PNG dimensions and resource paths.
- `data/research/runtime-discovery/tab-sprites.json`: exact resource atlas crop and source archive for registered tab sprites.
- Catalog reports: installed relationships, machine/tab updates, and image-render results.

## Interpretation rules

Use registered runtime associations over inferred names. Preserve recipe-specific machine restrictions already present in the catalog. Recipe IDs and ingredient identities must remain stable when changing artwork.

Forge container links supplement pure Fluid Canner fill/drain relationships. `RuntimeFluidContainer` is an optional catalog extension table included in game-pack SQLite exports. Older catalogs without it retain their previous behavior. Empty containers do not connect unrelated fluids; zero or ambiguous capacities must not invent conversion ratios.

Ore-dictionary alternatives identify acceptable ingredients. NEI collapsible item groups organize the item panel. These are distinct from fluid/container links and must not be transitively merged into universal recipe-output equivalence. NBT-dependent items and custom handler lookup code need explicit evidence.

For layout changes, inspect the handler's drawing code and runtime coordinates, then verify the rendered planner card. An atlas filename by itself does not establish crop bounds, padding, conditional slots, special slots, animated progress, or tooltips. Do not mark failed captures as verified layouts.

## Complete handler coverage pass

Use `prepare-runtime-discovery.mjs coverage`, rebuild, and launch the isolated exporter. This pass uses the public `getRecipeHandler` entry point with each handler's overlay, recipe ID and transfer-rectangle identifiers. Custom Diagram handlers use their diagram matcher rather than TemplateRecipeHandler methods, which they do not implement.

`handler-coverage.json` records every distinct slot arrangement across enumerated recipes. `information-pages.json` and `information-images` contain native Custom Diagram and Tool Materials reference pages. `lookup-associations.json` records the directed recipe/usage aliases produced by GT unification and familiar prefixes, including the output-side blacklist and ore-block metadata rules.

Install with `node scripts/install-nei-coverage.mjs`; then run `npx tsx scripts/check-nei-layout-coverage.ts`. Its `coverage.json` explicitly distinguishes verified slot coordinates, mismatches, missing catalog handlers, empty/item-dependent handlers, native information captures and cards still requiring visual review. Coordinate verification does not verify decorations, text or behavior.

The optional `RuntimeLookupAlias` and `RuntimeLookupHandler` tables scope these aliases to GT machine searches. They do not alter planner ingredient alternatives or conversion amounts. Native information pages have no Ingredient rows and cannot be added as production recipes.

For missing populated categories, write their handler IDs to `planner-export.coverage-targets.json` in the isolated instance before a coverage run. This captures every page through the native background, foreground and item renderers. The importer installs these as browse-only references, preserving input/output lookup direction and known alternatives; it does not invent crafting rates or production semantics. `native-layout-references.json` contains comparison captures for each distinct non-GT slot arrangement in the other categories.

Use `coverage-repairs` to retry context-dependent pages with an actual NEI recipe screen and to verify the union of crafting, usage and serial registries (`handler-registry.json`). Custom foreground implementations must be called: calling only `drawExtras` omits tanks in Tinkers/Forestry and other overlays. Custom Diagram interaction points are icon centres; subtract eight game pixels for HTML hit regions.
