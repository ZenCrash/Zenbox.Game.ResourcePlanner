"use client";
import { memo, useEffect, useRef, useState, type ReactNode, type DragEvent } from "react";
import { Plus } from "lucide-react";
import {
  applyVariants,
  cycleVariants,
  ingredientVariants,
  type Ingredient,
  type VariantSelection,
} from "@/lib/model";
import type { Item, Recipe } from "@/lib/model";
import { MinecraftText } from "./minecraft-text";
import { ItemTooltipLines } from "./item-tooltip-lines";
import { ItemTooltip } from "./item-tooltip";
import { useDisplaySettings } from "./display-settings";
import { PortItemOutline, usePortItemHighlight } from "./port-item-highlight";
import { recipePowerInfo } from "@/lib/recipe-power";
import { gameRecipeLayout, gameRecipeGeometry, type GameRecipeLayout } from "@/lib/game-recipe-layout";
import { isCombustionFuelHandler } from "@/lib/recipe-handlers";
import { machineTiers, tierColors } from "@/lib/machine-selection";
import {
  recipeSlotGroups,
  shapedCraftingSlots,
  type RecipeSlotCounts,
} from "@/lib/recipe-slots";
export type Browse = (
  item: Item,
  mode: "recipes" | "uses" | "category",
  selectedRecipeId?: string,
) => void;
function TierText({ text }: { text: string }) {
  return text
    .split(
      /(\b(?:ULV|LV|MV|HV|EV|IV|LuV|ZPM|UV|UHV|UEV|UIV|UMV|UXV|MAX)\b|[()])/gi,
    )
    .map((part, index) => {
      const tier = machineTiers.find(
        (value) => value.toLowerCase() === part.toLowerCase(),
      );
      return tier ? (
        <span
          key={index}
          className="recipe-tier-text"
          data-tier={tier}
          style={{ color: tierColors[tier] }}
        >
          {part}
        </span>
      ) : part === "(" || part === ")" ? (
        <span key={index} className="recipe-tier-parenthesis">
          {part}
        </span>
      ) : (
        part
      );
    });
}
function RecipeDetailRow({ text }: { text: string }) {
  const parts = text.match(/^([^:]+):\s*(.*)$/);
  if (!parts) return <div><TierText text={text} /></div>;
  return <div className="recipe-stat-row">
    <strong>{parts[1]}:</strong>{" "}
    <span><TierText text={parts[2]} /></span>
  </div>;
}
function fluidSlotAmount(amount: number) {
  if (amount < 10_000) return `${amount}L`;
  const units = [
    [1e12, "T"],
    [1e9, "G"],
    [1e6, "M"],
    [1e3, "k"],
  ] as const;
  const [scale, prefix] = units.find(([scale]) => amount >= scale)!;
  return `${(amount / scale).toLocaleString("en-US", { maximumFractionDigits: 2 })}${prefix}L`;
}

function FluidTooltipAmount({ amount }: { amount: number }) {
  return (
    <span className="fluid-tooltip-amount">
      Amount: {amount.toLocaleString("en-US")} L
    </span>
  );
}

export function ItemSlot({
  item,
  amount,
  onBrowse,
  onToggleGroup,
  groupHint,
  backgroundItem,
  groupExpanded,
  groupTitle,
  onAddItem,
  tooltipAtPointer,
  extraTooltip,
  ingredient,
  onItemDragStart,
  onItemDragEnd,
}: {
  item: Item;
  amount?: number;
  onBrowse?: Browse;
  onToggleGroup?: () => void;
  groupHint?: string;
  backgroundItem?: Item;
  groupExpanded?: boolean;
  groupTitle?: string;
  onAddItem?: (item: Item) => void;
  tooltipAtPointer?: boolean;
  ingredient?: Ingredient;
  onItemDragStart?: (item: Item, event: DragEvent<HTMLButtonElement>) => void;
  onItemDragEnd?: () => void;
  extraTooltip?: string[];
}) {
  const { settings } = useDisplaySettings();
  const accepted = ingredient?.direction === "input"
    ? ingredientVariants(ingredient)
    : [];
  const highlight = usePortItemHighlight();
  const amountLabel =
    amount === undefined
      ? undefined
      : item.kind === "fluid"
        ? fluidSlotAmount(amount)
        : `${amount}`;
  return (
    <button
      className="item-slot nodrag"
      draggable={!!onItemDragStart}
      onDragStart={onItemDragStart ? event => onItemDragStart(item, event) : undefined}
      onDragEnd={onItemDragEnd}
      data-item-id={item.id}
      data-port-highlighted={highlight.itemId === item.id || undefined}
      onClick={(event) => {
        if (event.ctrlKey && onAddItem) {
          event.preventDefault();
          onAddItem(item);
        } else if (event.shiftKey && onToggleGroup) {
          event.preventDefault();
          onToggleGroup();
        } else onBrowse?.(item, "recipes");
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onBrowse?.(item, "uses");
      }}
      aria-label={`${item.name}${amountLabel !== undefined ? ` × ${amountLabel}` : ""}`}
      aria-expanded={groupExpanded}
    >
      {highlight.itemId === item.id && <PortItemOutline />}
      {backgroundItem?.image && (
        <img
          className="group-background-item"
          draggable={false}
          src={backgroundItem.image}
          alt=""
        />
      )}
      <span
        className={`item-art ${backgroundItem ? "group-foreground-item" : ""}`}
      >
        {item.image ? (
          <img src={item.image} alt="" loading="lazy" draggable={false} />
        ) : (
          <span className="missing-item">?</span>
        )}
      </span>
      {amount !== undefined &&
        amount !== 0 &&
        (amount !== 1 || item.kind === "fluid") && (
          <span className="stack-count">{amountLabel}</span>
        )}
      <ItemTooltip followPointer={tooltipAtPointer}>
        <strong>
          <MinecraftText text={groupTitle || item.name} />
        </strong>
        {item.kind === "fluid" && amount !== undefined && (
          <FluidTooltipAmount amount={amount} />
        )}
        {!groupTitle && <ItemTooltipLines item={item} />}
        {extraTooltip?.map((line, index) => <span key={"extra" + index}><MinecraftText text={line} /></span>)}
        {!groupTitle && settings.showItemIds && (
          <small>
            {item.registryId}:{item.metadata}
          </small>
        )}
        {accepted.length > 1 && (
          <span className="tooltip-accepted">
            <span>Accepts following:</span>
            <span className="tooltip-accepted-items">
              {accepted.map(variant => (
                <span className="tooltip-accepted-item" key={variant.id} data-current={variant.id === item.id || undefined} aria-label={`${variant.name}${variant.id === item.id ? " (current)" : ""}`}>
                  {variant.image ? <img src={variant.image} alt={variant.name} /> : <span className="missing-item">?</span>}
                </span>
              ))}
            </span>
          </span>
        )}
        {!groupTitle && <em>{item.mod}</em>}
        {groupHint && <span className="group-hint">{groupHint}</span>}
      </ItemTooltip>
    </button>
  );
}

export function CyclingRecipe({
  recipe,
  headerTier,
  onBrowse,
  onSelect,
  disabled,
  pager,
  navigation,
  readOnly = false,
}: {
  recipe: Recipe;
  onBrowse: Browse;
  headerTier?: string;
  onSelect: (variants: VariantSelection, keepOpen: boolean) => void;
  disabled: boolean;
  pager?: ReactNode;
  navigation?: { previous: ReactNode; next: ReactNode };
  readOnly?: boolean;
}) {
  const [frame, setFrame] = useState(0);
  const [paused, setPaused] = useState(false);
  const held = useRef(false);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      held.current = event.shiftKey;
      setPaused(event.shiftKey);
    };
    const blur = () => {
      held.current = false;
      setPaused(false);
    };
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", key);
    window.addEventListener("blur", blur);
    const timer = setInterval(() => {
      if (!held.current) setFrame((value) => value + 1);
    }, 1000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("keydown", key);
      window.removeEventListener("keyup", key);
      window.removeEventListener("blur", blur);
    };
  }, []);
  const variants = cycleVariants(recipe, frame);
  let information = false;
  let referenceOnly = false;
  try { const layout = JSON.parse(recipe.layout); information = layout.information === true; referenceOnly = layout.referenceOnly === true; } catch {}
  return (
    <div
      onPointerMove={(event) => {
        held.current = event.shiftKey;
        if (paused !== event.shiftKey) setPaused(event.shiftKey);
      }}
    >
      <RecipeView
        recipe={applyVariants(recipe, variants)}
        headerTier={headerTier}
        belowTitle={pager}
        navigation={navigation}
        onBrowse={onBrowse}
      />
      {referenceOnly && <p className="variant-hint">Recipe reference · browsing only</p>}
      {!information && <p className="variant-hint">
        {paused ? "Variants paused" : "Hold Shift to pause variants"}
        {!readOnly && <><br />Adding a recipe locks the displayed items</>}
      </p>}
      {!readOnly && !information && <div className="recipe-add-actions">
      <button
        type="button"
        className="primary select-recipe"
        disabled={disabled}
        onClick={() => onSelect(variants, false)}
      >
        Add recipe to diagram
      </button>
      <button
        type="button"
        className="primary recipe-add-keep-open"
        disabled={disabled}
        onClick={() => onSelect(variants, true)}
        aria-label="Add recipe and keep selector open"
        title="Add recipe and keep selector open"
      >
        <Plus size={20} aria-hidden="true" />
      </button>
      </div>}
    </div>
  );
}
export function RecipeView({
  recipe,
  headerTier,
  referenceRecipe,
  referenceTimeTicks,
  machineCount = 1,
  isDefaultMachine = false,
  onBrowse,
  children,
  footerControl,
  minHeight,
  belowTitle,
  navigation,
}: {
  recipe: Recipe;
  headerTier?: string;
  referenceRecipe?: Recipe;
  referenceTimeTicks?: number;
  machineCount?: number;
  isDefaultMachine?: boolean;
  onBrowse?: Browse;
  children?: ReactNode;
  footerControl?: ReactNode;
  minHeight?: number;
  belowTitle?: ReactNode;
  navigation?: { previous: ReactNode; next: ReactNode };
}) {
  const power = recipePowerInfo(recipe);
  const count = Number.isFinite(machineCount)
    ? Math.max(0, machineCount)
    : 1;
  const countPrefix = count !== 1 ? `(x${count.toLocaleString(undefined, { maximumFractionDigits: 4 })}) ` : "";
  const comparisonColor = isDefaultMachine ? "#ffffff" : tierColors.MV;
  const reference =
    referenceRecipe &&
    (count !== 1 ||
      referenceRecipe.euPerTick !== recipe.euPerTick ||
      referenceRecipe.durationTicks !== recipe.durationTicks)
      ? referenceRecipe
      : undefined;
  const baseStats = reference ?? recipe;
  const basePower = recipePowerInfo(baseStats);
  const originalAmperage = Math.ceil(referenceRecipe ? recipePowerInfo(referenceRecipe).amperageValue : power.amperageValue);
  const currentAmperage = Math.ceil(power.amperageValue * count);
  const amperageChanged = originalAmperage !== currentAmperage;
  const originalTimeTicks = referenceTimeTicks ?? referenceRecipe?.durationTicks;
  const timeReference = recipe.durationTicks > 0 &&
    (originalTimeTicks ?? 0) > 0 && originalTimeTicks !== recipe.durationTicks
      ? originalTimeTicks : undefined;
  const isCrafting =
    recipe.handler === "Shaped Crafting" ||
    recipe.handler === "Shapeless Crafting";
  return (
    <div
      className={`recipe-view${isCrafting ? " shaped-crafting" : ""}`}
      style={{ minHeight }}
    >
      <div className="recipe-title">
        {navigation?.previous}
        <span>{recipe.handler}{headerTier && <> <span style={{ whiteSpace: "nowrap" }}>(<span style={{ color: tierColors[headerTier] ?? "#fff" }}>{headerTier}</span>)</span></>}</span>
        {navigation?.next}
      </div>
      {belowTitle}
      <RecipeProcessContent recipe={recipe} onBrowse={onBrowse} />
      <div className="recipe-footer" data-has-info={
        recipe.steamPerTick !== undefined ||
        !!(recipe.cycleDurationTicks && recipe.cycleDurationTicks !== recipe.durationTicks) ||
        (recipe.euPerTick > 0 && (recipe.durationTicks > 0 || !!power.voltage || !!power.amperage)) ||
        recipe.durationTicks !== 0 || power.details.length > 0 || undefined
      }>
        <div className="recipe-stats">
          {recipe.steamPerTick !== undefined && (
            <>
              <div className="recipe-stat-row">
                <strong>Total steam:</strong>
                <span className={count !== 1 ? "recipe-struck-stat" : undefined}>
                  {(recipe.steamPerBatch ?? recipe.steamPerTick * recipe.durationTicks).toLocaleString("en-US", { maximumFractionDigits: 3 })} L
                </span>
                {count !== 1 && (
                  <span className="recipe-comparison-stat recipe-updated-stat" style={{ color: tierColors.MV }}>
                    {countPrefix}{((recipe.steamPerBatch ?? recipe.steamPerTick * recipe.durationTicks) * count).toLocaleString("en-US", { maximumFractionDigits: 3 })} L
                  </span>
                )}
              </div>
              <div className="recipe-stat-row" title={recipe.steamPerBatch ? "Steam is consumed upfront per batch. This is the average supply needed for continuous operation." : undefined}>
                <strong>{recipe.steamPerBatch ? "Steam (avg.):" : "Steam:"}</strong>
                <span className={count !== 1 ? "recipe-struck-stat" : undefined}>
                  {recipe.steamPerTick.toLocaleString("en-US", { maximumFractionDigits: 3 })} L/t
                </span>
                {count !== 1 && (
                  <span className="recipe-comparison-stat recipe-updated-stat" style={{ color: tierColors.MV }}>
                    {countPrefix}{(recipe.steamPerTick * count).toLocaleString("en-US", { maximumFractionDigits: 3 })} L/t
                  </span>
                )}
              </div>
            </>
          )}
          {recipe.cycleDurationTicks && recipe.cycleDurationTicks !== recipe.durationTicks && <div className="recipe-stat-row"><strong>Batch interval:</strong><span>{recipe.cycleDurationTicks / 20} secs</span></div>}
          {recipe.euPerTick > 0 && (
            <>
              {recipe.durationTicks > 0 && (
                <div className="recipe-stat-row">
                  <strong>Total:</strong>{" "}
                  <span
                    className={reference ? "recipe-struck-stat" : undefined}
                  >
                    {(
                      baseStats.euPerTick * baseStats.durationTicks
                    ).toLocaleString()}{" "}
                    EU
                  </span>
                  {reference && (
                    <span
                      className="recipe-comparison-stat recipe-updated-stat"
                      style={{ color: comparisonColor }}
                    >
                      {countPrefix}
                      {(
                        recipe.euPerTick *
                        recipe.durationTicks *
                        count
                      ).toLocaleString()}{" "}
                      EU
                    </span>
                  )}
                </div>
              )}
              <div className="recipe-stat-row">
                {power.voltage && (
                  <>
                    <strong>Voltage:</strong>{" "}
                    <span
                      className={reference && !isDefaultMachine ? "recipe-struck-stat" : undefined}
                    >
                      <TierText
                        text={
                          basePower.voltage?.replace(/^Voltage: /, "") ?? ""
                        }
                      />
                    </span>
                  </>
                )}
                {reference && !isDefaultMachine && (
                  <span
                    className="recipe-comparison-stat recipe-updated-stat"
                    style={{ color: comparisonColor }}
                  >
                    {countPrefix}
                    <TierText
                      text={power.voltage?.replace(/^Voltage: /, "") ?? ""}
                    />
                  </span>
                )}
              </div>
              {power.amperage && <div className="recipe-stat-row">
                <strong>Amperage:</strong>{" "}
                <span className={amperageChanged ? "recipe-struck-stat" : undefined}>{originalAmperage.toLocaleString()} A</span>
                {amperageChanged && <span className="recipe-comparison-stat recipe-updated-stat" style={{ color: comparisonColor }}>
                  {countPrefix}{currentAmperage.toLocaleString()} A
                </span>}
              </div>}
            </>
          )}
          {recipe.durationTicks !== 0 && (
            <div className="recipe-stat-row">
              <strong>Time:</strong>{" "}
              <span className={timeReference !== undefined ? "recipe-struck-stat" : undefined}>
                {recipe.durationTicks > 0
                  ? `${(timeReference ?? recipe.durationTicks) / 20} secs`
                  : "Invalid runtime duration"}
              </span>
              {timeReference !== undefined && (
                <span className="recipe-comparison-stat recipe-updated-stat" style={{ color: comparisonColor }}>
                  {recipe.durationTicks / 20} secs
                </span>
              )}
            </div>
          )}
          {power.details.map((d, i) => <RecipeDetailRow key={i} text={d} />)}
        </div>
        {footerControl}
      </div>
      {children}
    </div>
  );
}

function AlchemicChemistryLayout({ recipe, onBrowse }: { recipe: Recipe; onBrowse?: Browse }) {
  const inputs = recipe.ingredients.filter(i => i.direction === "input");
  const output = recipe.ingredients.find(i => i.direction === "output");
  let lp: number | undefined;
  try { lp = JSON.parse(recipe.layout).lifeEssence; } catch {}
  const lpLabel = typeof lp === "number" ? `${lp.toLocaleString("en-US")}LP` : undefined;
  const positions = [[50, 0], [0, 32], [100, 32], [26, 88], [74, 88]];
  const slot = (ingredient: typeof output, label: string) => ingredient ? (
    <ItemSlot ingredient={ingredient} item={ingredient.item} amount={ingredient.amount || undefined} onBrowse={onBrowse} />
  ) : <span className="item-slot empty-recipe-slot" role="img" aria-label={label} />;
  return (
    <div className="alchemic-chemistry-layout" style={{ width: Math.max(216, 156 + (lpLabel?.length ?? 0) * 12) }} role="group" aria-label="Alchemic Chemistry Set recipe">
      {positions.map(([left, top], index) => (
        <div className="alchemic-slot" style={{ left, top }} key={index}>
          {slot(inputs.find(i => i.slot === index), `Empty alchemy input slot ${index + 1}`)}
        </div>
      ))}
      <div className="alchemic-slot alchemic-output" aria-label="Alchemy output">{slot(output, "Empty alchemy output")}</div>
      <div className="alchemic-slot alchemic-orb" aria-label="Required blood orb (not consumed)">
        {slot(inputs.find(i => i.slot === 5), "Blood orb slot")}
      </div>
      {lpLabel && <span className="alchemic-lp">{lpLabel}</span>}
    </div>
  );
}

function InfernalBlastFurnaceLayout({
  recipe,
  onBrowse,
}: {
  recipe: Recipe;
  onBrowse?: Browse;
}) {
  const input = recipe.ingredients.find((i) => i.direction === "input");
  const outputs = recipe.ingredients.filter((i) => i.direction === "output");
  const slot = (ingredient: typeof input) =>
    ingredient ? (
      <ItemSlot
        ingredient={ingredient} item={ingredient.item}
        amount={ingredient.amount}
        onBrowse={onBrowse}
      />
    ) : (
      <span
        className="item-slot empty-recipe-slot"
        role="img"
        aria-label="Empty furnace slot"
      />
    );
  return (
    <div className="infernal-furnace-layout">
      <div className="infernal-furnace-input">{slot(input)}</div>
      <CategorySymbol
        className="infernal-furnace-art"
        recipe={recipe}
        onBrowse={onBrowse}
      >
        <span aria-hidden="true" />
      </CategorySymbol>
      <div className="infernal-furnace-output">{slot(outputs[0])}</div>
      <div
        className="infernal-furnace-bonus"
        role="group"
        aria-label="Bonus output"
      >
        {slot(outputs[1])}
      </div>
    </div>
  );
}

function SingleInputMachineLayout({
  recipe,
  onBrowse,
}: {
  recipe: Recipe;
  onBrowse?: Browse;
}) {
  const mold = recipe.ingredients.find(
    (i) => i.direction === "input" && i.item.kind !== "fluid",
  );
  const output = recipe.ingredients.find((i) => i.direction === "output");
  const fluids = recipe.ingredients.filter(
    (i) => i.direction === "input" && i.item.kind === "fluid",
  );
  return (
    <div className="fluid-solidifier-layout">
      {([mold, output] as const).map((ingredient, index) => (
        <div
          className={`fluid-solidifier-${index === 0 ? "mold" : "output"}`}
          key={index}
        >
          {ingredient ? (
            <>
              <ItemSlot
                ingredient={ingredient} item={ingredient.item}
                amount={ingredient.amount}
                onBrowse={onBrowse}
              />
              {!ingredient.consumed && (
                <span className="tic-extruding-nc" aria-label="Not consumed">
                  NC
                </span>
              )}
            </>
          ) : (
            <span
              className="item-slot empty-recipe-slot"
              role="img"
              aria-label={`Empty ${index === 0 ? "input" : "output"} slot`}
            />
          )}
        </div>
      ))}
      <CategorySymbol
        className="fluid-solidifier-progress blast-furnace-progress"
        recipe={recipe}
        onBrowse={onBrowse}
      >
        {recipe.handler === "Large Boiler" || isCombustionFuelHandler(recipe.handler) ? (
          <PlainRecipeArrow />
        ) : (
          <span aria-hidden="true" />
        )}
      </CategorySymbol>
      {fluids.length > 0 && (
        <div
          className="fluid-solidifier-fluids"
          role="group"
          aria-label="Required fluid inputs"
        >
          {fluids.map((fluid) => (
            <ItemSlot
              key={`${fluid.slot}:${fluid.itemId}`}
              ingredient={fluid} item={fluid.item}
              amount={fluid.amount}
              onBrowse={onBrowse}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FurnaceGridLayout({
  recipe,
  onBrowse,
}: {
  recipe: Recipe;
  onBrowse?: Browse;
}) {
  const bricked = recipe.handler === "Bricked Blast Furnace";
  const arcRecycling = recipe.handler === "Arc Furnace Recycling";
  const macerator = recipe.handler === "Macerator Recycling";
  const counts = {
    itemInputs: arcRecycling || macerator ? 1 : bricked ? 3 : 6,
    itemOutputs: macerator ? 4 : arcRecycling ? 9 : bricked ? 3 : 6,
    fluidInputs: bricked || macerator ? 0 : 1,
    fluidOutputs: bricked || arcRecycling || macerator ? 0 : 1,
  };
  const groups = (direction: "input" | "output") =>
    recipeSlotGroups(recipe.ingredients, direction, counts)
      .filter((group) => group.slots.length)
      .map((group) => {
        if (!bricked || group.kind !== "item") return group;
        // The primitive furnace reserves the last slot for fuel / its byproduct.
        const occupied = group.slots.filter((i) => i !== null);
        return occupied.length === 2
          ? { ...group, slots: [occupied[0], null, occupied[1]] }
          : group;
      });
  return (
    <div
      className={`blast-furnace-layout${bricked ? " bricked-blast-furnace-layout" : ""}${arcRecycling ? " arc-recycling-layout" : ""}${macerator ? " macerator-recycling-layout" : ""}`}
    >
      {(["input", "output"] as const).map((direction) => (
        <div className={`blast-furnace-${direction}`} key={direction}>
          {groups(direction).map(({ kind, slots }) => (
            <div
              className={`blast-furnace-${kind}-slots`}
              role="group"
              aria-label={`${recipe.handler} ${kind} ${direction} slots`}
              key={kind}
            >
              {slots.map((ingredient, index) => (
                <div className="blast-furnace-slot" key={index}>
                  {ingredient ? (
                    <ItemSlot
                      ingredient={ingredient} item={ingredient.item}
                      amount={ingredient.amount}
                      onBrowse={onBrowse}
                    />
                  ) : (
                    <span
                      className="item-slot empty-recipe-slot"
                      role="img"
                      aria-label={`Empty ${kind} ${direction} slot`}
                    />
                  )}
                  {ingredient &&
                    direction === "output" &&
                    ingredient.chance < 1 && (
                      <span
                        className="blast-furnace-chance"
                        aria-label={`${ingredient.chance * 100}% chance`}
                      >
                        {Number((ingredient.chance * 100).toFixed(2))}%
                      </span>
                    )}
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
      <CategorySymbol
        className="blast-furnace-progress"
        recipe={recipe}
        onBrowse={onBrowse}
      >
        <span aria-hidden="true" />
      </CategorySymbol>
    </div>
  );
}

function TwoInputMachineLayout({
  recipe,
  onBrowse,
}: {
  recipe: Recipe;
  onBrowse?: Browse;
}) {
  const counts = {
    itemInputs: 2,
    itemOutputs: 1,
    fluidInputs: 0,
    fluidOutputs: 0,
  };
  return (
    <div
      className={`tic-extruding-layout${recipe.handler === "Extruder" ? " extruder-layout" : ""}${recipe.handler === "Alloy Smelter Molding" || recipe.handler === "Alloy Smelter Recycling" ? " alloy-molding-layout" : ""}`}
    >
      {(["input", "output"] as const).map((direction) => (
        <div
          className={`tic-extruding-${direction}`}
          role="group"
          aria-label={`${recipe.handler} ${direction} slots`}
          key={direction}
        >
          {recipeSlotGroups(recipe.ingredients, direction, counts)
            .flatMap(({ slots }) => slots)
            .map((ingredient, index) => (
              <div className="tic-extruding-slot" key={index}>
                {ingredient ? (
                  <>
                    <ItemSlot
                      ingredient={ingredient} item={ingredient.item}
                      amount={ingredient.amount}
                      onBrowse={onBrowse}
                    />
                    {!ingredient.consumed && (
                      <span
                        className="tic-extruding-nc"
                        aria-label="Not consumed"
                      >
                        NC
                      </span>
                    )}
                  </>
                ) : (
                  <span
                    className="item-slot empty-recipe-slot"
                    role="img"
                    aria-label={`Empty ${direction} slot`}
                  />
                )}
              </div>
            ))}
        </div>
      ))}
      <CategorySymbol
        className="tic-extruding-progress"
        recipe={recipe}
        onBrowse={onBrowse}
      >
        <span aria-hidden="true" />
      </CategorySymbol>
    </div>
  );
}

function CastingTableLayout({
  recipe,
  onBrowse,
}: {
  recipe: Recipe;
  onBrowse?: Browse;
}) {
  const highlight = usePortItemHighlight();
  const cast = recipe.ingredients.find(
    (i) => i.direction === "input" && i.item.kind !== "fluid",
  );
  const fluid = recipe.ingredients.find(
    (i) => i.direction === "input" && i.item.kind === "fluid",
  );
  const output = recipe.ingredients.find((i) => i.direction === "output");
  return (
    <div className="casting-table-layout">
      <span className="casting-table-art" aria-hidden="true" />
      {fluid && (
        <button
          className={`casting-table-flow nodrag${cast ? "" : " without-cast"}`}
          data-port-highlighted={highlight.itemId === fluid.item.id || undefined}
          aria-label={`${fluid.item.name}: ${fluid.amount} L`}
          style={{
            backgroundImage: fluid.item.image
              ? `url(${JSON.stringify(fluid.item.image)})`
              : undefined,
          }}
          onClick={() => onBrowse?.(fluid.item, "recipes")}
          onContextMenu={(event) => {
            event.preventDefault();
            onBrowse?.(fluid.item, "uses");
          }}
        >
          {highlight.itemId === fluid.item.id && <PortItemOutline />}
          <ItemTooltip>
            <strong>{fluid.item.name}</strong>
            <FluidTooltipAmount amount={fluid.amount} />
          </ItemTooltip>
        </button>
      )}
      {cast && (
        <div className="casting-table-cast">
          <ItemSlot ingredient={cast} item={cast.item} amount={cast.amount} onBrowse={onBrowse} />
        </div>
      )}
      <CategorySymbol
        className="casting-table-arrow"
        recipe={recipe}
        onBrowse={onBrowse}
      >
        <span aria-hidden="true" />
      </CategorySymbol>
      <div className="casting-table-output">
        {output ? (
          <ItemSlot
            ingredient={output} item={output.item}
            amount={output.amount}
            onBrowse={onBrowse}
          />
        ) : (
          <span
            className="item-slot empty-recipe-slot"
            aria-label="Empty casting output"
          />
        )}
      </div>
    </div>
  );
}

function SmeltingLayout({
  recipe,
  onBrowse,
}: {
  recipe: Recipe;
  onBrowse?: Browse;
}) {
  const input = recipe.ingredients.find((i) => i.direction === "input");
  const output = recipe.ingredients.find((i) => i.direction === "output");
  return (
    <div className="smelting-layout">
      <div className="smelting-input" role="group" aria-label="Smelting input">
        {input ? (
          <ItemSlot
            ingredient={input} item={input.item}
            amount={input.amount}
            onBrowse={onBrowse}
          />
        ) : (
          <span className="item-slot empty-recipe-slot" />
        )}
      </div>
      <img
        className="smelting-flames"
        src="/ui/smelting-flames.svg"
        alt=""
        aria-hidden="true"
      />
      <div
        className="smelting-fuel"
        role="group"
        aria-label="Example furnace fuel"
      >
        {recipe.smeltingFuel ? (
          <ItemSlot item={recipe.smeltingFuel} onBrowse={onBrowse} />
        ) : (
          <span className="item-slot empty-recipe-slot" />
        )}
      </div>
      <CategorySymbol
        className="smelting-arrow"
        recipe={recipe}
        onBrowse={onBrowse}
      >
        <PlainRecipeArrow />
      </CategorySymbol>
      <div
        className="smelting-output"
        role="group"
        aria-label="Smelting output"
      >
        {output ? (
          <ItemSlot
            ingredient={output} item={output.item}
            amount={output.amount}
            onBrowse={onBrowse}
          />
        ) : (
          <span className="item-slot empty-recipe-slot" />
        )}
      </div>
    </div>
  );
}

function CarpenterLayout({
  recipe,
  onBrowse,
}: {
  recipe: Recipe;
  onBrowse?: Browse;
}) {
  const inputs = recipe.ingredients.filter(
    (i) => i.direction === "input" && i.item.kind !== "fluid",
  );
  const grid = Array.from({ length: 9 }, (_, index) =>
    inputs.find((i) =>
      i.x !== null && i.y !== null
        ? Math.round((i.x - 5) / 18) === index % 3 &&
          Math.round((i.y - 6) / 18) === Math.floor(index / 3)
        : i.slot === Math.floor(index / 3) + (index % 3) * 3,
    ),
  );
  const extra = inputs.find((i) => (i.x !== null ? i.x >= 59 : i.slot >= 9));
  const output = recipe.ingredients.find(
    (i) => i.direction === "output" && i.item.kind !== "fluid",
  );
  const fluid = recipe.ingredients.find(
    (i) => i.direction === "input" && i.item.kind === "fluid",
  );
  const slot = (ingredient: typeof output) =>
    ingredient ? (
      <ItemSlot
        ingredient={ingredient} item={ingredient.item}
        amount={ingredient.amount}
        onBrowse={onBrowse}
      />
    ) : (
      <span
        className="item-slot empty-recipe-slot"
        role="img"
        aria-label="Empty Carpenter slot"
      />
    );
  const arrow = (
    <PlainRecipeArrow />
  );
  return (
    <div className="carpenter-layout">
      <div
        className="carpenter-inputs"
        role="group"
        aria-label="Carpenter crafting inputs"
      >
        {grid.map((ingredient, index) => (
          <div key={index}>{slot(ingredient)}</div>
        ))}
      </div>
      <div className="carpenter-extra">{slot(extra)}</div>
      <div className="carpenter-result">
        {slot(output)}
        <span className="carpenter-meter" aria-hidden="true" />
      </div>
      <div className="carpenter-container-input">{slot(undefined)}</div>
      <div className="carpenter-container-output">{slot(undefined)}</div>
      <CategorySymbol
        className="carpenter-arrow input-arrow"
        recipe={recipe}
        onBrowse={onBrowse}
      >
        {arrow}
      </CategorySymbol>
      <CategorySymbol
        className="carpenter-arrow extra-arrow"
        recipe={recipe}
        onBrowse={onBrowse}
      >
        {arrow}
      </CategorySymbol>
      <CategorySymbol
        className="carpenter-arrow output-arrow"
        recipe={recipe}
        onBrowse={onBrowse}
      >
        {arrow}
      </CategorySymbol>
      <CategorySymbol
        className="carpenter-arrow tank-arrow"
        recipe={recipe}
        onBrowse={onBrowse}
      >
        {arrow}
      </CategorySymbol>
      <FluidTank fluid={fluid} onBrowse={onBrowse} capacity={64000} />
    </div>
  );
}

function BottlerLayout({
  recipe,
  onBrowse,
}: {
  recipe: Recipe;
  onBrowse?: Browse;
}) {
  const fluid =
    recipe.bottlerFluid ??
    recipe.ingredients.find(
      (ingredient) =>
        ingredient.direction === "input" && ingredient.item.kind === "fluid",
    );

  return (
    <div className="bottler-layout">
      <FluidTank fluid={fluid} onBrowse={onBrowse} />
      <CategorySymbol
        className="bottler-arrow"
        recipe={recipe}
        onBrowse={onBrowse}
      >
        <PlainRecipeArrow />
      </CategorySymbol>
      <div className="bottler-containers">
        {(["input", "output"] as const).map((direction) => {
          const items = recipe.ingredients.filter(
            (ingredient) =>
              ingredient.direction === direction &&
              ingredient.item.kind !== "fluid",
          );
          return (
            <div
              className={`bottler-${direction}`}
              role="group"
              aria-label={`Bottler item ${direction}`}
              key={direction}
            >
              {items.length ? (
                items.map((ingredient) => (
                  <ItemSlot
                    key={ingredient.slot}
                    ingredient={ingredient} item={ingredient.item}
                    amount={ingredient.amount}
                    onBrowse={onBrowse}
                  />
                ))
              ) : (
                <span
                  className="item-slot empty-recipe-slot"
                  role="img"
                  aria-label={`Empty ${direction} slot`}
                />
              )}
            </div>
          );
        })}
        <svg
          className="bottler-funnel"
          viewBox="0 0 36 26"
          aria-hidden="true"
          shapeRendering="crispEdges"
        >
          <path d="M2 2H34L23 24H13Z" fill="#8b8b8b" />
          <path d="M1 1H35M2 3L13 25" fill="none" stroke="#373737" />
          <path d="M35 3L24 25H13" fill="none" stroke="#fff" />
        </svg>
      </div>
    </div>
  );
}

function DistillationTowerLayout({
  recipe,
  onBrowse,
}: {
  recipe: Recipe;
  onBrowse?: Browse;
}) {
  const counts = {
    itemInputs: 2,
    itemOutputs: 1,
    fluidInputs: 1,
    fluidOutputs: 11,
  };
  const outputs = recipeSlotGroups(recipe.ingredients, "output", counts);
  const slots = [...outputs[0].slots, ...outputs[1].slots];
  return (
    <div className="distillation-tower-layout">
      <div className="tower-inputs">
        {recipeSlotGroups(recipe.ingredients, "input", counts).map(
          ({ kind, slots }) => (
            <div
              className={`tower-${kind}-inputs`}
              role="group"
              aria-label={`Distillation Tower ${kind} inputs`}
              key={kind}
            >
              {slots.map((ingredient, index) =>
                ingredient ? (
                  <ItemSlot
                    key={index}
                    ingredient={ingredient} item={ingredient.item}
                    amount={ingredient.amount}
                    onBrowse={onBrowse}
                  />
                ) : (
                  <span
                    key={index}
                    className="item-slot empty-recipe-slot"
                    role="img"
                    aria-label={`Empty ${kind} input slot`}
                  />
                ),
              )}
            </div>
          ),
        )}
      </div>
      <CategorySymbol
        className="tower-progress"
        recipe={recipe}
        onBrowse={onBrowse}
      >
        <img className="faithful-recipe-symbol" src="/ui/faithful/arrow_multiple.png" alt="" aria-hidden="true" />
      </CategorySymbol>
      <div
        className="tower-outputs"
        role="group"
        aria-label="Distillation Tower outputs"
      >
        {slots.map((ingredient, index) => (
          <div
            className={`tower-output-slot${index === 0 ? " item-output" : " fluid-output"}${ingredient ? " occupied" : ""}`}
            style={{
              gridColumn: (index % 3) + 1,
              gridRow: Math.ceil(slots.length / 3) - Math.floor(index / 3),
            }}
            key={index}
          >
            {ingredient ? (
              <ItemSlot
                ingredient={ingredient} item={ingredient.item}
                amount={ingredient.amount}
                onBrowse={onBrowse}
              />
            ) : (
              <span
                className="item-slot empty-recipe-slot"
                role="img"
                aria-label={`Empty output slot ${index}`}
              />
            )}
            <span className="tower-slot-number" aria-hidden="true">
              {index}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MachineRecipeLayout({
  recipe,
  onBrowse,
}: {
  recipe: Recipe;
  onBrowse?: Browse;
}) {
  const circuit = recipe.handler === "Circuit Assembler";
  const abs = recipe.handler === "ABS Non-Alloy Recipes";
  const autoclave = recipe.handler === "Autoclave";
  const press = recipe.handler === "Forming Press";
  const distillery = recipe.handler === "Distillery";
  const chemical = recipe.handler === "Chemical Reactor";
  const largeChemical = recipe.handler === "Large Chemical Reactor";
  const plant = recipe.handler === "Chemical Plant";
  const mixer = recipe.handler === "Mixer";
  const vat = recipe.handler === "Bacterial Vat";
  const multiblockMixer = recipe.handler === "Multiblock Mixer";
  const fermenter = recipe.handler === "Fermenter";
  const semifluidFuel = recipe.handler === "Semifluid Generator Fuels";
  const brewery = recipe.handler === "Brewery";
  const canner = recipe.handler === "Fluid Canner";
  const compressor = recipe.handler === "Compressor";
  const rockBreaker = recipe.handler === "Rock Breaker";
  const electrolyzer = recipe.handler === "Electrolyzer";
  const fluidExtractor =
    recipe.handler === "Fluid Extractor" ||
    recipe.handler === "Fluid Extractor Recycling";
  const distilleryItemRows = Math.max(
    1,
    ...(["input", "output"] as const).map(
      (direction) =>
        recipe.ingredients.filter(
          (ingredient) =>
            ingredient.direction === direction &&
            ingredient.item.kind !== "fluid",
        ).length,
    ),
  );
  const counts = {
    itemInputs: fermenter || semifluidFuel
      ? 0
      : plant
        ? 4
        : largeChemical
          ? 6
          : chemical || rockBreaker || electrolyzer || autoclave
            ? 2
            : distillery || fluidExtractor || canner || compressor || brewery
              ? 1
              : circuit || press || vat
                ? 6
                : 9,
    itemOutputs: fermenter || brewery || semifluidFuel
      ? 0
      : multiblockMixer || abs
        ? 9
        : mixer || autoclave
          ? 4
          : largeChemical || plant || electrolyzer
            ? 6
            : chemical || vat
              ? 2
              : 1,
    fluidInputs:
      abs ? 3 : fluidExtractor || rockBreaker
        ? 0
        : plant
          ? 4
          : largeChemical || multiblockMixer
            ? 6
            : 1,
    fluidOutputs: plant || abs
      ? 3
      : largeChemical || multiblockMixer
        ? 6
        : distillery ||
            chemical ||
            mixer ||
            vat ||
            fermenter ||
            brewery ||
            fluidExtractor ||
            electrolyzer ||
            autoclave ||
            canner
          ? 1
          : 0,
  };
  return (
    <div
      data-autoclave={autoclave || undefined}
      data-abs-non-alloy={abs || undefined}
      data-semifluid-fuel={semifluidFuel || undefined}
      className={`assembler-layout${circuit || press ? " circuit-assembler-layout" : ""}${press ? " forming-press-layout" : ""}${distillery ? " distillery-layout" : ""}${chemical ? " chemical-reactor-layout" : ""}${largeChemical || multiblockMixer ? " large-chemical-reactor-layout" : ""}${multiblockMixer ? " multiblock-mixer-layout" : ""}${plant ? " chemical-plant-layout" : ""}${mixer ? " mixer-layout" : ""}${vat ? " bacterial-vat-layout" : ""}${fermenter || brewery || semifluidFuel ? " fermenter-layout" : ""}${brewery ? " brewery-layout" : ""}${fluidExtractor ? " fluid-extractor-layout" : ""}${canner ? " fluid-canner-layout" : ""}${compressor ? " compressor-layout" : ""}${rockBreaker ? " rock-breaker-layout" : ""}${electrolyzer ? " electrolyzer-layout" : ""}`}
    >
      {(["input", "output"] as const).map((direction) => (
        <div className={`assembler-${direction}`} key={direction}>
          {recipeSlotGroups(recipe.ingredients, direction, counts).map(
            ({ kind, slots }) =>
              slots.length > 0 && (
                <div
                  className={`assembler-${kind}-slots`}
                  style={
                    distillery && kind === "item"
                      ? { minHeight: distilleryItemRows * 36 }
                      : undefined
                  }
                  role="group"
                  aria-label={`${recipe.handler} ${kind} ${direction} slots`}
                  key={kind}
                >
                  {slots.map((ingredient, index) => (
                    <div className={`assembler-slot ${kind}`} key={index}>
                      {ingredient ? (
                        <ItemSlot
                          ingredient={ingredient} item={ingredient.item}
                          amount={ingredient.amount}
                          onBrowse={onBrowse}
                        />
                      ) : (
                        <span
                          className="item-slot empty-recipe-slot"
                          role="img"
                          aria-label={`Empty ${recipe.handler} ${kind} ${direction} slot`}
                        />
                      )}
                      {abs && ingredient && !ingredient.consumed && (
                        <span className="tic-extruding-nc" aria-label="Not consumed">{recipe.handler === "Milling" && /ball/i.test(ingredient.item.name) ? "NC*" : "NC"}</span>
                      )}
                      {autoclave && ingredient && direction === "output" && ingredient.chance < 1 && (
                        <span className="blast-furnace-chance" aria-label={`${ingredient.chance * 100}% chance`}>
                          {Number((ingredient.chance * 100).toFixed(2))}%
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ),
          )}
          {vat && direction === "output" && (
            <span
              className="item-slot empty-recipe-slot vat-culture-slot"
              role="img"
              aria-label="Culture slot (culture data unavailable)"
            />
          )}
        </div>
      ))}
      <CategorySymbol
        className="assembler-progress"
        recipe={recipe}
        onBrowse={onBrowse}
      >
        {abs || semifluidFuel ? <PlainRecipeArrow /> : autoclave ? <PlainRecipeArrow /> : mixer || multiblockMixer ? <MixerRecipeSymbol /> : <img
          className="faithful-recipe-symbol"
          src={
            rockBreaker ? "/ui/faithful/macerate.png" : compressor ? "/ui/faithful/compress.png" : canner
              ? "/ui/faithful/canner.png"
              : fluidExtractor || electrolyzer
                ? "/ui/faithful/extract.png"
                : plant || mixer || multiblockMixer
                  ? "/ui/faithful/mixer.png"
                  : distillery || chemical || largeChemical || vat || fermenter || brewery
                    ? "/ui/faithful/arrow_multiple.png"
                    : press
                      ? "/ui/faithful/compress.png"
                      : circuit
                        ? "/ui/faithful/circuit_assembler.png"
                        : "/ui/faithful/assemble.png"
          }
          alt=""
          aria-hidden="true"
        />}
      </CategorySymbol>
    </div>
  );
}

function BatchRecipeLayout({ recipe, onBrowse }: { recipe: Recipe; onBrowse?: Browse }) {
  const metadata = JSON.parse(recipe.layout);
  const kind: string = metadata.batchLayout;
  const info = metadata.batchFields ?? {};
  const inputs = recipe.ingredients.filter(i => i.direction === 'input');
  const outputs = recipe.ingredients.filter(i => i.direction === 'output');
  const slot = (i: Ingredient | undefined, x: number, y: number, key: string, chance?: number) => <div key={key} className={'batch-layout-slot' + ((['binding','ender-alloy'].includes(kind) && i?.direction === 'output') || kind === 'decayables' ? ' batch-native-frame' : '')} style={{ left: x * 2, top: y * 2 }}>
    {i ? <ItemSlot ingredient={i} item={i.item} amount={i.amount} onBrowse={onBrowse} /> : <span className="item-slot empty-recipe-slot" />}
    {i && !i.consumed && <span className="tic-extruding-nc">NC</span>}
    {(chance ?? (i?.direction === 'output' ? i.chance : 1))! < 1 && <span className="blast-furnace-chance">{Number(((chance ?? i!.chance) * 100).toFixed(1))}%</span>}
  </div>;
  if (kind === 'acclimatiser') {
    // Center the visible six-column grid, not the padded NEI texture atlas.
    // The upper treatment slot is centered between the two middle columns.
    const at = (x: number, y: number) => recipe.ingredients.find(i => i.x === x && i.y === y);
    return <div className="batch-recipe-layout batch-acclimatiser" style={{ width: 216, height: 126, margin: '12px auto' }} aria-label="Acclimatiser recipe layout">
      {slot(at(76, 2), 45, 0, 'treatment')}
      {Array.from({ length: 12 }, (_, n) => {
        const column = n % 6, row = Math.floor(n / 6);
        return slot(at(31 + column * 18, 29 + row * 18), column * 18, 27 + row * 18, 'organism-' + n);
      })}
    </div>;
  }
  if (recipe.handler === 'Aspect Combination') return <div className="batch-aspect-equation">
    {outputs.map(i => <ItemSlot key={i.slot} item={i.item} onBrowse={onBrowse} />)}<span>=</span>
    {inputs.map((i,n) => <span className="batch-aspect-term" key={i.slot}>{n > 0 && <span>+</span>}<ItemSlot item={i.item} onBrowse={onBrowse} /></span>)}
  </div>;
  if (recipe.handler === 'Clarifier') {
    const fluidsIn=inputs.filter(i=>i.item.kind==='fluid'), fluidsOut=outputs.filter(i=>i.item.kind==='fluid');
    const solids=outputs.filter(i=>i.item.kind!=='fluid');
    return <div className="batch-recipe-layout" style={{width:344,height:160}}>
      <img className="batch-layout-background" style={{width:340}} src="/ui/recipe-layouts/clarifier.png" alt="" />
      {slot(fluidsIn[0],6,7,'water')}{slot(fluidsOut[0],154,7,'clean')}
      {slot(inputs.find(i=>i.item.kind!=='fluid'),79,43,'filter',0.2)}
      {Array.from({length:4},(_,n)=>slot(solids[n],136+(n%2)*18,43+Math.floor(n/2)*18,'drop'+n))}
    </div>;
  }
  const height = kind === 'analyzer' ? 152 : kind === 'calcinator' ? 100 : ['binding','ender-alloy','decayables'].includes(kind) ? 130 : kind === 'animal-trap' ? 132 : 160;
  return <div className={'batch-recipe-layout batch-'+kind} style={{width:kind==='animal-trap'?340:332,height}} aria-label={recipe.handler+' recipe layout'}>
    <img className="batch-layout-background" src={'/ui/recipe-layouts/'+kind+'.png'} alt="" />
    {kind === 'calcinator' ? <>
      {inputs.map((i,n)=>slot(i,(i.x??32)-1,(i.y??(n?33:6))-1,'in'+n))}
      <div className="batch-reagent-result"><span>{Number(info.amount).toLocaleString('de-DE')} AR</span><span style={{color:info.color}}>{info.name}</span></div>
    </> : recipe.ingredients.map((i,n)=>slot(i,(i.x??0)-1+(kind==='animal-trap'?2:0),(i.y??0)-1,String(n)))}
    {kind==='ender-alloy' && <span className="batch-rf">{Number(info.energy).toLocaleString('de-DE')} RF</span>}
    {kind==='decayables' && <div className="batch-decay-info"><span>Information</span><span>Time Taken</span><span style={{color:'#538000'}}>{Math.floor(info.time/1200)} Minutes</span></div>}
    {kind==='binding' && <>
      <span className="batch-ritual-icon" style={{left:0}} tabIndex={0}><img src={info.ritualIcon} alt="Ritual information" /><ItemTooltip followPointer><div>Ritual Name: Ritual of Binding</div><div>Activation Cost: 5,000</div></ItemTooltip></span>
      <span className="batch-ritual-icon" style={{right:0}} tabIndex={0}><img src={info.reagentIcon} alt="Reagent information" /><ItemTooltip followPointer>No reagents can be added to this ritual.</ItemTooltip></span>
    </>}
  </div>;
}

function GameDefinedRecipeLayout({ recipe, definition, onBrowse }: { recipe: Recipe; definition: GameRecipeLayout; onBrowse?: Browse }) {
  const geometry = gameRecipeGeometry(definition, recipe.ingredients);
  const special: Item | undefined = JSON.parse(recipe.layout).specialItem;
  return (
    <div className="game-defined-recipe-layout" style={{ width: geometry.width, height: geometry.height }} aria-label={recipe.handler + " recipe layout"}>
      {geometry.slots.map(({ ingredient, kind, direction, index, x, y, overlay }) => (
        <div className={"game-defined-slot " + kind} key={direction + kind + index}
          style={{ left: (x - 16) * 2, top: (y - 6) * 2, ...(overlay ? { "--game-slot-overlay": 'url("/ui/faithful/slot-' + overlay + '.png")' } : {}) } as React.CSSProperties}>
          {ingredient ? <ItemSlot ingredient={ingredient} item={ingredient.item} amount={ingredient.amount} onBrowse={onBrowse} />
            : <span className="item-slot empty-recipe-slot" role="img" aria-label={"Empty " + kind + " " + direction + " slot"} />}
          {ingredient && !ingredient.consumed && <span className="tic-extruding-nc" aria-label="Not consumed">NC</span>}
          {ingredient && direction === "output" && ingredient.chance < 1 && <span className="blast-furnace-chance" aria-label={ingredient.chance * 100 + "% chance"}>{Number((ingredient.chance * 100).toFixed(2))}%</span>}
        </div>
      ))}
      <CategorySymbol className="game-defined-progress" recipe={recipe} onBrowse={onBrowse}>
        <img className="faithful-recipe-symbol" src={"/ui/faithful/" + definition.texture + ".png"} alt="" aria-hidden="true" />
      </CategorySymbol>
      {['Bio Lab', 'Circuit Assembly Line'].includes(recipe.handler) && <div className="game-defined-slot item" style={{ left: 216, top: 112 }}>{special ? <ItemSlot item={special} onBrowse={onBrowse} /> : <span className="item-slot empty-recipe-slot" />}{special && recipe.handler === 'Circuit Assembly Line' && <span className="tic-extruding-nc">NC</span>}</div>}
      {definition.decorations.map((decoration, index) => <img key={index} className="game-defined-decoration"
        src={"/ui/faithful/" + decoration.texture + ".png"} alt="" aria-hidden="true"
        style={{ left: (decoration.x - 16) * 2, top: (decoration.y - 6) * 2, width: decoration.width * 2, height: decoration.height * 2 }} />)}
    </div>
  );
}

function PlainRecipeArrow() {
  return <img className="faithful-recipe-symbol" src="/ui/faithful/arrow.png" width="40" height="36" alt="" aria-hidden="true" />;
}

function MixerRecipeSymbol() {
  return <img className="faithful-recipe-symbol" src="/ui/faithful/mixer.png" width="40" height="36" alt="" aria-hidden="true" />;
}

function CategorySymbol({
  recipe,
  onBrowse,
  className,
  children,
}: {
  recipe: Recipe;
  onBrowse?: Browse;
  className: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={className + " recipe-category-symbol nodrag"}
      aria-label={"Show all " + recipe.handler + " recipes"}
      onClick={(event) => {
        event.stopPropagation();
        onBrowse?.(
          {
            id: recipe.handler,
            name: recipe.handler,
            registryId: "",
            metadata: 0,
            mod: "",
            group: "",
            tooltip: "[]",
            image: null,
            kind: "category",
          },
          "category",
          recipe.id,
        );
      }}
    >
      {children}
      <ItemTooltip compact followPointer placement="top-right">
        <strong style={{ color: "#fff" }}>Recipes</strong>
      </ItemTooltip>
    </button>
  );
}

function FluidTank({
  fluid,
  onBrowse,
  capacity = 10000,
}: {
  fluid?: { item: Item; amount: number };
  onBrowse?: Browse;
  capacity?: number;
}) {
  const highlight = usePortItemHighlight();
  const fill = fluid
    ? Math.min(100, Math.max(0, (fluid.amount / capacity) * 100))
    : 0;
  return (
    <button
      className="bottler-tank nodrag"
      data-port-highlighted={!!fluid && highlight.itemId === fluid.item.id || undefined}
      disabled={!fluid}
      aria-label={
        fluid
          ? `${fluid.item.name}: ${fluid.amount} L`
          : "Tank (fluid data unavailable)"
      }
      onClick={() => fluid && onBrowse?.(fluid.item, "recipes")}
      onContextMenu={(event) => {
        event.preventDefault();
        if (fluid) onBrowse?.(fluid.item, "uses");
      }}
    >
      {fluid && highlight.itemId === fluid.item.id && <PortItemOutline />}
      <span className="bottler-tank-fill" style={{ height: `${fill}%` }}>
        <span
          className="bottler-tank-texture"
          style={{
            backgroundImage: fluid?.item.image
              ? `url(${JSON.stringify(fluid.item.image)})`
              : undefined,
          }}
        />
      </span>
      {Array.from({ length: 9 }, (_, index) => (
        <span
          key={index}
          className={`bottler-tank-mark${index === 4 ? " major" : ""}`}
          style={{ bottom: `${(index + 1) * 10}%` }}
          aria-hidden="true"
        />
      ))}
      {fluid && (
        <ItemTooltip>
          <strong>{fluid.item.name}</strong>
          <FluidTooltipAmount amount={fluid.amount} />
        </ItemTooltip>
      )}
    </button>
  );
}

const RecipeProcessContent = memo(function RecipeProcessContent({ recipe, onBrowse }: { recipe: Recipe; onBrowse?: Browse }) {
  const isCrafting = recipe.handler === "Shaped Crafting" || recipe.handler === "Shapeless Crafting";
  const crafting = isCrafting ? shapedCraftingSlots(recipe.ingredients) : null;
  let layout: {
    information?: boolean;
    informationImage?: string;
    informationSlots?: { x: number; y: number; item: Item }[];
    components?: { x: number; y: number; item: Item; description: string }[];
    batchLayout?: string;
    background?: string;
    width?: number;
    height?: number;
    slotCounts?: RecipeSlotCounts;
  } = {};
  try {
    layout = JSON.parse(recipe.layout);
  } catch {}
  if (layout.information && layout.informationImage) return (
    <div className="nei-information-scroll">
      <div className="nei-information-page" style={{ width: (layout.width ?? 166) * 2, maxWidth: '100%', aspectRatio: `${layout.width ?? 166} / ${layout.height ?? 110}` }}>
        <img src={layout.informationImage} alt={`${recipe.handler} information diagram`} draggable={false} />
        {(layout.informationSlots ?? []).map((slot, index) => <div key={index} style={{ position: 'absolute', left: slot.x * 2, top: slot.y * 2 }}><ItemSlot item={slot.item} onBrowse={onBrowse} /></div>)}
        {(layout.components ?? []).filter((c, i, all) => all.findIndex(a => a.x === c.x && a.y === c.y) === i).map((component, index) => (
          <button key={index} className="nei-information-link" style={{ left: `${component.x / (layout.width ?? 166) * 100}%`, top: `${component.y / (layout.height ?? 110) * 100}%`, width: `${16 / (layout.width ?? 166) * 100}%`, height: `${16 / (layout.height ?? 110) * 100}%` }} title={component.item.name} aria-label={`Recipes for ${component.item.name}`} onClick={() => onBrowse?.(component.item, 'recipes')} onContextMenu={event => { event.preventDefault(); onBrowse?.(component.item, 'uses'); }} />
        ))}
      </div>
    </div>
  );
  return <>      {crafting ? (
        <div className="crafting-layout">
          <div
            className="crafting-inputs"
            role="group"
            aria-label="Crafting inputs, 3 by 3 grid"
          >
            {crafting.inputs.map((ingredient, index) =>
              ingredient ? (
                <ItemSlot
                  key={index}
                  ingredient={ingredient} item={ingredient.item}
                  amount={ingredient.amount}
                  onBrowse={onBrowse}
                />
              ) : (
                <span
                  key={index}
                  className="item-slot empty-recipe-slot"
                  role="img"
                  aria-label={`Empty crafting slot ${index + 1}`}
                />
              ),
            )}
          </div>
          <CategorySymbol
            className="crafting-arrow"
            recipe={recipe}
            onBrowse={onBrowse}
          >
            <PlainRecipeArrow />
          </CategorySymbol>
          <div
            className="crafting-output"
            role="group"
            aria-label="Crafting output"
          >
            {crafting.output ? (
              <ItemSlot
                ingredient={crafting.output} item={crafting.output.item}
                amount={crafting.output.amount}
                onBrowse={onBrowse}
              />
            ) : (
              <span
                className="item-slot empty-recipe-slot"
                role="img"
                aria-label="Empty crafting output slot"
              />
            )}
          </div>
        </div>
      ) : layout.batchLayout || ["Aspect Combination", "Clarifier"].includes(recipe.handler) ? (
        <BatchRecipeLayout recipe={recipe} onBrowse={onBrowse} />
      ) : ["Shaped A.Worktable", "Shapeless A.Worktable", "Arcane Infusion", "Crucible", "SAG Mill", "Assemblyline Process", "Mob Info", "Research Station", "Scanner", "Space Mining", "Tree Growth Simulator", "Squeezer", "Brewing"].includes(recipe.handler) ? (
        <ScreenshotRecipeLayout recipe={recipe} onBrowse={onBrowse} />
      ) : recipe.handler === "Coke Oven" && !layout.slotCounts ? (
        <CokeOvenLayout recipe={recipe} onBrowse={onBrowse} />
      ) : recipe.handler === "Alchemic Chemistry Set" ? (
        <AlchemicChemistryLayout recipe={recipe} onBrowse={onBrowse} />
      ) : ["Smelting", "Blasting"].includes(recipe.handler) ? (
        <SmeltingLayout recipe={recipe} onBrowse={onBrowse} />
      ) : recipe.handler === "Casting Table" ? (
        <CastingTableLayout recipe={recipe} onBrowse={onBrowse} />
      ) : recipe.handler === "Infernal Blast Furnace" ? (
        <InfernalBlastFurnaceLayout recipe={recipe} onBrowse={onBrowse} />
      ) : recipe.handler === "TiC Part Extruding" ||
        recipe.handler === "Extruder" ||
        recipe.handler === "Alloy Smelter Molding" ||
        recipe.handler === "Alloy Smelter Recycling" ? (
        <TwoInputMachineLayout recipe={recipe} onBrowse={onBrowse} />
      ) : recipe.handler === "Fluid Solidifier" ||
        recipe.handler === "TiC Bolt Molding" ||
        recipe.handler === "Large Boiler" ||
        isCombustionFuelHandler(recipe.handler) ||
        recipe.handler.startsWith("Magic Energy Absorber Fu") ? (
        <SingleInputMachineLayout recipe={recipe} onBrowse={onBrowse} />
      ) : recipe.handler === "Blast Furnace" ||
        recipe.handler === "Bricked Blast Furnace" ||
        recipe.handler === "Arc Furnace Recycling" ||
        recipe.handler === "Macerator Recycling" ? (
        <FurnaceGridLayout recipe={recipe} onBrowse={onBrowse} />
      ) : recipe.handler === "Carpenter" ? (
        <CarpenterLayout recipe={recipe} onBrowse={onBrowse} />
      ) : recipe.handler === "Bottler" ? (
        <BottlerLayout recipe={recipe} onBrowse={onBrowse} />
      ) : recipe.handler === "Distillation Tower" ? (
        <DistillationTowerLayout recipe={recipe} onBrowse={onBrowse} />
      ) : recipe.handler === "ABS Non-Alloy Recipes" ||
        recipe.handler === "Assembler" ||
        recipe.handler === "Circuit Assembler" ||
        recipe.handler === "Forming Press" ||
        recipe.handler === "Distillery" ||
        recipe.handler === "Chemical Reactor" ||
        recipe.handler === "Large Chemical Reactor" ||
        recipe.handler === "Chemical Plant" ||
        recipe.handler === "Mixer" ||
        recipe.handler === "Bacterial Vat" ||
        recipe.handler === "Multiblock Mixer" ||
        recipe.handler === "Fermenter" ||
        recipe.handler === "Semifluid Generator Fuels" ||
        recipe.handler === "Brewery" ||
        recipe.handler === "Fluid Extractor" ||
        recipe.handler === "Fluid Extractor Recycling" ||
        recipe.handler === "Electrolyzer" ||
        recipe.handler === "Autoclave" ||
        recipe.handler === "Fluid Canner" ||
        recipe.handler === "Compressor" ||
        recipe.handler === "Rock Breaker" ? (
        <MachineRecipeLayout recipe={recipe} onBrowse={onBrowse} />
      ) : gameRecipeLayout(recipe.handler) ? (
        <GameDefinedRecipeLayout recipe={recipe} definition={gameRecipeLayout(recipe.handler)!} onBrowse={onBrowse} />
      ) : (
        <div className="recipe-process default-recipe-process">
          <CategorySymbol className="default-recipe-arrow" recipe={recipe} onBrowse={onBrowse}>
            <PlainRecipeArrow />
          </CategorySymbol>
          {(["input", "output"] as const).map((direction) => (
            <div className={`recipe-slot-side recipe-slot-side-${direction}`} key={direction}>
              <div className="recipe-slot-groups">
                {recipeSlotGroups(
                  recipe.ingredients,
                  direction,
                  layout.slotCounts,
                ).map(
                  ({ kind, slots }) =>
                    slots.length > 0 && (
                      <div
                        className="recipe-slots"
                        key={kind}
                        role="group"
                        aria-label={`${kind === "fluid" ? "Fluid" : "Item"} ${direction} slots`}
                        style={
                          layout.slotCounts
                            ? {
                                gridTemplateColumns: `repeat(${Math.min(slots.length, 3)}, 36px)`,
                              }
                            : undefined
                        }
                      >
                        {slots.map((ingredient, index) =>
                          ingredient ? (
                            <ItemSlot
                              key={index}
                              ingredient={ingredient} item={ingredient.item}
                              amount={ingredient.amount}
                              onBrowse={onBrowse}
                            />
                          ) : (
                            <span
                              key={index}
                              className={`item-slot empty-recipe-slot ${kind === "fluid" ? "empty-fluid-slot" : ""}`}
                              role="img"
                              aria-label={`Empty ${kind} ${direction} slot`}
                              title={`Empty ${kind} ${direction} slot`}
                            />
                          ),
                        )}
                      </div>
                    ),
                )}
              </div>
            </div>
          ))}
        </div>
      )}
</>;
});

type ScreenshotMetadata = {
  specialItem?: Item;
  toolItems?: Item[][];
  instability?: number;
  energy?: number;
  researchItem?: Item;
  mob?: { name: string; mod: string; health: number; infernal: number; image?: string; spawns: string[]; groups: Record<string, number[]>; dropTooltips?: string[][]; dropDurability?: (number | null)[]; additionalInformation?: string[]; spawnItem?: Item; usage?: number; seconds?: number };
};
function ScreenshotRecipeLayout({ recipe, onBrowse }: { recipe: Recipe; onBrowse?: Browse }) {
  const metadata: ScreenshotMetadata = JSON.parse(recipe.layout);
  const h = recipe.handler;
  if (["Research Station", "Scanner", "Space Mining", "Tree Growth Simulator", "Squeezer", "Brewing"].includes(h)) return <AdditionalRecipeLayout recipe={recipe} metadata={metadata} onBrowse={onBrowse} />;
  const isThaum = ["Shaped A.Worktable", "Shapeless A.Worktable", "Arcane Infusion", "Crucible"].includes(h);
  const slot = (ingredient: Ingredient | undefined, x: number, y: number, key: string, plain = false) => <div key={key} className={"screenshot-slot" + (plain ? " plain" : "") + (ingredient?.item.kind === "fluid" || key.startsWith("fluid") ? " fluid" : "")} style={{ left: x * 2, top: y * 2 }}>
    {ingredient ? <ItemSlot ingredient={ingredient} item={ingredient.item} amount={ingredient.amount} onBrowse={onBrowse} /> : <span className="item-slot empty-recipe-slot" />}
    {ingredient && ingredient.direction === "output" && ingredient.chance < 1 && <span className="blast-furnace-chance">{Number((ingredient.chance * 100).toFixed(2))}%</span>}
  </div>;
  const art = (name: string, x: number, y: number, width: number, height: number, category = false) => category
    ? <CategorySymbol key={name} className="screenshot-art" recipe={recipe} onBrowse={onBrowse}><img src={`/ui/recipe-layouts/${name}.png`} style={{ width: width * 2, height: height * 2 }} alt="" /></CategorySymbol>
    : <img key={name} className="screenshot-art" src={`/ui/recipe-layouts/${name}.png`} style={{ left: x * 2, top: y * 2, width: width * 2, height: height * 2 }} alt="" />;
  if (h === "Mob Info") return <MobInfoLayout recipe={recipe} metadata={metadata.mob} onBrowse={onBrowse} />;
  if (h === "Assemblyline Process") {
    const inputs = recipe.ingredients.filter(i => i.direction === "input" && i.item.kind !== "fluid");
    const fluids = recipe.ingredients.filter(i => i.direction === "input" && i.item.kind === "fluid");
    const outputs = recipe.ingredients.filter(i => i.direction === "output");
    return <div className="screenshot-recipe-layout" style={{ width: 288, height: Math.max(144, Math.ceil(inputs.length / 4) * 36, fluids.length * 36) }} aria-label={h + " recipe layout"}>
      {art('assembly-1', 72, 0, 17, 72)}{art('assembly-2', 108, 0, 18, 72)}{art('assembly-3', 130, 18, 10, 18)}
      {Array.from({ length: Math.max(16, inputs.length) }, (_, i) => slot(inputs[i], i % 4 * 18, Math.floor(i / 4) * 18, 'in' + i))}
      {Array.from({ length: Math.max(4, fluids.length) }, (_, i) => slot(fluids[i], 90, i * 18, 'fluid' + i))}
      {slot(outputs[0], 126, 0, 'out')}
      {metadata.researchItem ? <div className="screenshot-slot" style={{ left: 252, top: 72 }}><ItemSlot item={metadata.researchItem} onBrowse={onBrowse} /></div> : slot(undefined, 126, 36, "research")}
      <CategorySymbol className="assembly-category-hit" recipe={recipe} onBrowse={onBrowse}><span /></CategorySymbol>
    </div>;
  }
  if (h === "SAG Mill") return <div className="screenshot-recipe-layout" style={{ width: 332, height: 130 }} aria-label={h + " recipe layout"}>
    {art('sag', 0, 0, 166, 65)}
    {recipe.ingredients.map((i, n) => slot(i, i.x ?? 74, i.y ?? 2, String(n), true))}
    {metadata.energy != null && <span className="screenshot-energy" style={{ left: 192, top: 66 }}>{metadata.energy.toLocaleString('en-US')} RF</span>}
    <CategorySymbol className="sag-category-hit" recipe={recipe} onBrowse={onBrowse}><span /></CategorySymbol>
  </div>;
  if (isThaum) {
    const infusion = h === 'Arcane Infusion', crucible = h === 'Crucible';
    const height = Math.max(crucible ? 270 : infusion ? 294 : 280, ...recipe.ingredients.map(i => ((i.y ?? 0) + 18) * 2));
    return <div className="screenshot-recipe-layout thaum-layout" style={{ width: 332, height }} aria-label={h + " recipe layout"}>
      {infusion ? <>{art('rune', 69, -5, 28, 30)}{art('infusion', 34, 28.25, 98, 77)}</> : crucible ? <>{art('rune', 65, 3, 28, 30)}{art('crucible', 30, 48.5, 98, 84)}{art('crucible-arrow', 66.75, 34.5, 19.25, 22.75)}</> : <>{art('arcane-grid', 37.4, 24.1, 88.4, 88.4)}{art('rune', 68, -3.1, 27.2, 27.2)}{art('wand', 4, height / 2 - 24, 24, 24)}</>}
      {recipe.ingredients.map((i, n) => slot(i, i.x ?? 0, infusion && i.item.name.startsWith("Aspect:") ? Math.max(129, i.y ?? 129) : i.y ?? 0, String(n), true))}
      {infusion && metadata.instability != null && <span className="infusion-instability" style={{ top: 234 }}>Instability: {metadata.instability}</span>}
    </div>;
  }
  return null;
}
function CokeOvenLayout({ recipe, onBrowse }: { recipe: Recipe; onBrowse?: Browse }) {
  const input = recipe.ingredients.find(i => i.direction === 'input');
  const output = recipe.ingredients.find(i => i.direction === 'output' && i.item.kind !== 'fluid');
  const fluid = recipe.ingredients.find(i => i.direction === 'output' && i.item.kind === 'fluid');
  return <div className="coke-oven-layout" aria-label="Coke Oven recipe layout">
    <div className="coke-input"><img className="coke-flames" src="/ui/smelting-flames.svg" alt="" />{input && <ItemSlot ingredient={input} item={input.item} amount={input.amount} onBrowse={onBrowse} />}</div>
    <CategorySymbol className="coke-arrow" recipe={recipe} onBrowse={onBrowse}><PlainRecipeArrow /></CategorySymbol>
    <span className="coke-time">{recipe.durationTicks} ticks</span>
    <div className="coke-output">{output && <ItemSlot ingredient={output} item={output.item} amount={output.amount} onBrowse={onBrowse} />}</div>
    <FluidTank fluid={fluid} onBrowse={onBrowse} />
  </div>;
}
function MobInfoLayout({ recipe, metadata, onBrowse }: { recipe: Recipe; metadata?: ScreenshotMetadata['mob']; onBrowse?: Browse }) {
  if (!metadata) return <div className="mob-info-layout"><p>Mob details have not been exported for this recipe.</p><CategorySymbol className="mob-category" recipe={recipe} onBrowse={onBrowse}><img src="/ui/recipe-layouts/mob-sword.png" width={28} height={28} alt="" /></CategorySymbol></div>;
  const outputs = recipe.ingredients.filter(i => i.direction === 'output');
  const input = metadata.spawnItem ?? recipe.ingredients.find(i => i.direction === 'input')?.item;
  return <div className="mob-info-layout">
    <div className="mob-info-top"><div><div className="mob-portrait">{metadata.image ? <img src={metadata.image} alt={metadata.name} /> : <span className="mob-portrait-unavailable">Portrait unavailable</span>}{input && <div className="mob-spawn-item"><ItemSlot item={input} onBrowse={onBrowse} /></div>}</div><div className="mob-tools"><CategorySymbol className="mob-category" recipe={recipe} onBrowse={onBrowse}><img src="/ui/recipe-layouts/mob-sword.png" width={28} height={28} alt="" /></CategorySymbol><span tabIndex={0}><img src="/ui/recipe-layouts/mob-info.png" width={17} height={28} alt="Drop information" /><ItemTooltip compact><span>Drop chances and sizes are averages across all possibilities. A 100% chance does not always guarantee a drop: equal chances of 0, 1, or 2 items average to 1 item per drop (100%).</span></ItemTooltip></span></div></div>
      <div className="mob-description"><strong>{metadata.name}</strong><span>Mod: {metadata.mod}</span><span>Max health: {metadata.health}</span>{metadata.infernal > 0 && <span className="mob-infernal">Can spawn infernal</span>}<span className="mob-spawns" tabIndex={0}>Spawns in {metadata.spawns.length} places…<ItemTooltip compact><div className="mob-spawn-list">{metadata.spawns.map((s, i) => <div key={i}>{s}</div>)}</div></ItemTooltip></span>{metadata.additionalInformation?.map((text, i) => <span key={i}><MinecraftText text={text} /></span>)}{metadata.usage != null && <span>Usage: {metadata.usage} EU/t</span>}{metadata.seconds != null && <span>Time: {metadata.seconds} secs</span>}</div>
    </div>
    {['Normal', 'Rare', 'Additional', 'Infernal'].map(name => { const indices = metadata.groups[name] ?? [];return indices.length ? <section key={name}><h4>{name} drops</h4><div className="mob-drops">{indices.map(index => { const i=outputs[index];return i ? <div key={index}><ItemSlot ingredient={i} item={i.item} amount={i.amount} onBrowse={onBrowse} extraTooltip={metadata.dropTooltips?.[index]} />{metadata.dropDurability?.[index] != null && <small>{metadata.dropDurability[index]}%</small>}</div> : null; })}</div></section> : null; })}
  </div>;
}

// Native NEI/ModularUI positions, in game pixels displayed at 2x.
function AdditionalRecipeLayout({ recipe, metadata, onBrowse }: { recipe: Recipe; metadata: ScreenshotMetadata; onBrowse?: Browse }) {
  const h = recipe.handler;
  const ingredients = [...recipe.ingredients].sort((a,b) => (a.slot ?? 0) - (b.slot ?? 0));
  const inputs = ingredients.filter(i => i.direction === "input" && i.item.kind !== "fluid");
  const outputs = ingredients.filter(i => i.direction === "output" && i.item.kind !== "fluid");
  const fluids = (side: "input" | "output") => ingredients.filter(i => i.direction === side && i.item.kind === "fluid");
  const slot = (i: Ingredient | undefined, x: number, y: number, key: string, plain = false) => <div key={key} className={"screenshot-slot" + (plain ? " plain" : "") + (key.startsWith("fluid") ? " fluid" : "")} style={{left:x*2,top:y*2}}>
    {i ? <ItemSlot ingredient={i} item={i.item} amount={i.amount} onBrowse={onBrowse} /> : <span className="item-slot empty-recipe-slot" />}
    {i && !i.consumed && <span className="tic-extruding-nc">NC</span>}
    {i && i.direction === "output" && i.chance < 1 && <span className="blast-furnace-chance">{Number((i.chance*100).toFixed(2))}%</span>}
  </div>;
  const special = (x: number,y: number,nc = false) => <div className="screenshot-slot" style={{left:x*2,top:y*2}}>{metadata.specialItem ? <ItemSlot item={metadata.specialItem} onBrowse={onBrowse} /> : <span className="item-slot empty-recipe-slot" />}{nc && metadata.specialItem && <span className="tic-extruding-nc">NC</span>}</div>;
  const art = (name: string,x: number,y: number,w: number,ht: number) => <img className="screenshot-art" src={`/ui/recipe-layouts/${name}.png`} style={{left:x*2,top:y*2,width:w*2,height:ht*2}} alt="" />;
  const arrow = (x: number,y: number) => <div style={{position:"absolute",left:x*2,top:y*2}}><CategorySymbol className="additional-category-symbol" recipe={recipe} onBrowse={onBrowse}><PlainRecipeArrow /></CategorySymbol></div>;
  const frame = (w: number,ht: number,content: ReactNode) => <div className={"screenshot-recipe-layout additional-layout " + (h === "Squeezer" ? "squeezer-layout" : "")} style={{width:w*2,height:ht*2}} aria-label={h+" recipe layout"}>{content}</div>;
  if (h === "Research Station") return frame(126,74,<>
    {art("heat_sink",0,6,84,60)}{art("rack_large",22,16,40,40)}
    {art("research-1",62,34,25,5)}{art("research-2",105,34,11,5)}{art("research-3",109,38,10,18)}
    {slot(inputs[0],33,27,"input")}{slot(outputs[0],87,27,"output")}{special(105,56)}
    <div style={{position:"absolute",left:124,top:54}}><CategorySymbol className="research-category-hit" recipe={recipe} onBrowse={onBrowse}><span /></CategorySymbol></div>
  </>);
  if (h === "Scanner") return frame(126,74,<>{slot(inputs[0],18,18,"input")}{arrow(44,18)}{slot(outputs[0],72,18,"output")}{slot(fluids("input")[0],18,56,"fluid-input")}{special(90,56)}</>);
  if (h === "Tree Growth Simulator") return frame(108,63,<>
    {special(45,0,true)}{arrow(44,36)}
    {Array.from({length:4},(_,n) => <div className="screenshot-slot" key={n} style={{left:n%2*36,top:(27+Math.floor(n/2)*18)*2}}>{metadata.toolItems?.[n]?.[0] ? <ItemSlot item={metadata.toolItems[n][0]} ingredient={{itemId:metadata.toolItems[n][0].id,item:metadata.toolItems[n][0],direction:"input",amount:1,chance:1,consumed:false,slot:n,x:null,y:null,alternatives:JSON.stringify(metadata.toolItems[n].map(i=>i.id)),alternativeItems:metadata.toolItems[n]}} onBrowse={onBrowse} /> : <span className="item-slot empty-recipe-slot" />}</div>)}
    {Array.from({length:4},(_,n)=>slot(outputs.find(i=>i.slot===n),72+n%2*18,27+Math.floor(n/2)*18,"out"+n))}
  </>);
  if (h === "Space Mining") return frame(151,72,<>
    {art("space-mining",36,0,23,63)}
    {slot(inputs[0],133,9,"drone")}
    {Array.from({length:4},(_,n)=>slot(inputs[n+1],n%2*18,Math.floor(n/2)*18,"in"+n))}
    {Array.from({length:2},(_,n)=>slot(fluids("input")[n],n*18,45,"fluid"+n))}
    {Array.from({length:Math.max(16,outputs.length)},(_,n)=>slot(outputs.find(i=>i.slot===n),59+n%4*18,Math.floor(n/4)*18,"out"+n))}
    <div style={{position:"absolute",left:72,top:0}}><CategorySymbol className="space-mining-category-hit" recipe={recipe} onBrowse={onBrowse}><span /></CategorySymbol></div>
  </>);
  if (h === "Brewing") return frame(66,58,<>
    {art("brewing",0,0,66,58)}
    {ingredients.map(i=>slot(i,(i.x ?? 74)-50,(i.y ?? 6)-3,i.direction+":"+i.slot,true))}
    <div style={{position:"absolute",left:90,top:0}}><CategorySymbol className="brewing-category-hit" recipe={recipe} onBrowse={onBrowse}><span /></CategorySymbol></div>
  </>);
  const fluid = fluids("output")[0];
  return frame(166,68,<>
    {art("squeezer",0,0,166,68)}
    {inputs.map(i=>slot(i,(i.x ?? 12)-1,(i.y ?? 10)-1,i.direction+":"+i.slot,true))}
    {outputs.map(i=>slot(i,91,48,i.direction+":"+i.slot,true))}
    <div className="squeezer-fluid"><FluidTank fluid={fluid} onBrowse={onBrowse} /></div>
    <div style={{position:"absolute",left:140,top:60}}><CategorySymbol className="squeezer-category-hit" recipe={recipe} onBrowse={onBrowse}><span /></CategorySymbol></div>
  </>);
}
