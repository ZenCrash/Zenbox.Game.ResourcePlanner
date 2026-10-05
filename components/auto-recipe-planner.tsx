"use client";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ReactFlowProvider,
  useStore,
  type Node,
  type Edge,
} from "@xyflow/react";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  WandSparkles,
  X,
  Ban,
} from "lucide-react";
import type {
  PlannerOptions,
  PlannerPlan,
  PlannerResult,
} from "@/lib/auto-planner";
import {
  type Item,
  type Recipe,
  type VariantSelection,
} from "@/lib/model";
import { machineTiers } from "@/lib/machine-selection";
import { Inventory } from "./inventory";
import { PlannerFilterDropdown } from "./planner-filter-dropdown";
import { PlannerPriorityList } from "./planner-priority-list";
import { defaultPlannerPriorities, prioritiesForTarget } from "@/lib/planner-priorities";
import { plannerBalance } from "@/lib/planner-balance";
import { plannerDefaultCalculators } from '@/lib/planner-calculators';
import { summarizePlanner } from '@/lib/planner-summary';
import { PlannerCalculatorResults } from './planner-calculator-results';
import { DiagramLoadingProgress } from "./diagram-loading-progress";
import { useFuelValues } from "./use-fuel-values";
import { OverviewZoomOverride, useDisplaySettings } from './display-settings';
import { PlannerPreview } from "./planner-preview";
import { PlannerNeededItems, PlannerNeededBans } from './planner-needed-items';
import { readPlannerResultStream } from '@/lib/planner-result-stream';
import { defaultPlannerSearchDuration } from '@/lib/planner-search-settings';
import { useItemFamilies } from './use-item-families';
import { plannerPositions } from "@/lib/planner-columns";
import { readPlannerFilters, plannerFiltersKey } from "@/lib/planner-filters";

export type PlannedNode = Node<
  {
    recipe: Recipe;
    machineId?: string;
    multiblock?: import("@/lib/multiblock").MultiblockConfig;
    machines: number;
    variants: VariantSelection;
    disabledPorts?: string[];
  },
  "recipe"
>;
export type PlannedGraph = { nodes: PlannedNode[]; edges: Edge[]; ignoredItems?: string[]; group?: { title: string; headerHeight?: number; theme?: import('@/lib/group-theme').GroupTheme; calculators?: import('@/lib/summary-rate').SummaryCalculation[]; targetItem?: Item; fuelDefaultsPending?: boolean } };
const emptyPreviewGraph: PlannedGraph = { nodes: [], edges: [] };

const CachedSuggestionPreview = memo(function CachedSuggestionPreview({ cacheKey, graph, active, machineLimits, onChange, onReady }: {
  cacheKey: string; graph: PlannedGraph; active: boolean;
  machineLimits: { allowMultiblocks: boolean; balanceMachines: boolean; maxTier: number; maxTotalEu?: number };
  onChange: (key: string, graph: PlannedGraph) => void;
  onReady: (key: string) => void;
}) {
  const ready = useCallback(() => onReady(cacheKey), [cacheKey, onReady]);
  const update = useCallback((next: PlannedGraph) => onChange(cacheKey, next), [cacheKey, onChange]);
  // React Flow nodes set visibility: visible themselves. Hide the entire layer
  // with opacity while retaining its dimensions and cached viewport.
  return <div className="planner-cached-preview" aria-hidden={!active} inert={!active}
    style={{ visibility: active ? 'visible' : 'hidden', opacity: active ? 1 : 0, pointerEvents: active ? 'auto' : 'none' }}>
    <ReactFlowProvider><PlannerPreview onReady={ready} active={active} graph={graph} machineLimits={machineLimits} onChange={update} /></ReactFlowProvider>
  </div>;
});

export function plannerGraph(plan: PlannerPlan): PlannedGraph {
  const balance = plannerBalance(plan);
  const positions = plannerPositions(plan.steps.length, plan.links,
    new Set(plan.steps.flatMap((step, index) => step.recovery ? [index] : [])));
  const rowHeight = Math.max(
    500,
    ...plan.steps.map(
      (step) =>
        Math.max(
          ...["input", "output"].map(
            (direction) =>
              step.recipe.ingredients.filter((i) => i.direction === direction)
                .length,
          ),
        ) *
          42 +
        240,
    ),
  );
  const nodes: PlannedNode[] = plan.steps.map((step, index) => ({
    id: `plan-${index}`,
    type: "recipe",
    position: {
      x: positions.get(index)!.column * 860,
      y: positions.get(index)!.row * rowHeight,
    },
    data: {
      recipe: step.recipe,
      machineId: step.machineId,
      multiblock: step.multiblock,
      machines: balance.machines[index],
      variants: step.variants,
    },
  }));
  const edges: Edge[] = plan.links.map((link, index) => {
    const item = plan.steps[link.source].recipe.ingredients.find(
      (i) => i.direction === "output" && i.slot === link.sourceSlot,
    )!.item;
    return {
      id: `plan-edge-${index}`,
      source: nodes[link.source].id,
      target: nodes[link.target].id,
      sourceHandle: `output:${link.sourceSlot}`,
      targetHandle: `input:${link.targetSlot}`,
      type: "grid",
      data: { item },
    };
  });
  return { nodes, edges };
}


export function AutoRecipePlanner({
  onClose,
  onAdd,
  embedded = false,
  initialTarget,
  initialMachineLimits,
}: {
  embedded?: boolean;
  initialTarget?: Item;
  initialMachineLimits?: { allowMultiblocks: boolean; maxTier: number; maxTotalEu?: number; balanceMachines?: boolean };
  onClose: () => void;
  onAdd: (graph: PlannedGraph, keepOpen?: boolean) => void;
}) {
  // An inline planner lives inside another flow's transformed viewport. Cancel
  // that transform's scale for its own canvas: React Flow measures handles in
  // screen pixels and only divides by its own viewport zoom.
  const parentZoom = useStore((state) => embedded ? state.transform[2] : 1);
  const { settings } = useDisplaySettings();
  const [overviewZoom, setOverviewZoom] = useState<number>();
  const previewOverviewZoom = overviewZoom ?? settings.overviewZoom;
  const [saved] = useState(readPlannerFilters);
  const [target, setTarget] = useState<Item | undefined>(initialTarget ?? saved.target);
  const [inputs, setInputs] = useState<Item[]>(saved.inputs ?? (saved.input ? [saved.input] : []));
  const [picker, setPicker] = useState<"target" | "input" | null>(null);
  const [priorityOrder, setPriorities] = useState(saved.priorities ?? defaultPlannerPriorities(saved.priority));
  const targetFuelValues = useFuelValues(target ? [target.id] : []);
  const priorities = useMemo(() => prioritiesForTarget(priorityOrder, !!target && !!targetFuelValues[target.id]), [priorityOrder, target?.id, targetFuelValues]);
  const [allowMultiblocks, setAllowMultiblocks] = useState(
    initialMachineLimits?.allowMultiblocks ?? saved.allowMultiblocks,
  );
  const [maxTier, setMaxTier] = useState(initialMachineLimits?.maxTier ?? saved.maxTier);
  const [maxTotalEu, setMaxTotalEu] = useState(initialMachineLimits ? String(initialMachineLimits.maxTotalEu ?? '') : saved.maxTotalEu);
  const [balanceMachines, setBalanceMachines] = useState(initialMachineLimits?.balanceMachines ?? saved.balanceMachines);
  const [editingMaxTotalEu, setEditingMaxTotalEu] = useState(false);
  const [maxSteps, setMaxSteps] = useState(saved.maxSteps);
  const [maxSuggestions, setMaxSuggestions] = useState(saved.maxSuggestions);
  const searchDurationSeconds = defaultPlannerSearchDuration;
  const [bannedMachineIds, setBannedMachineIds] = useState(
    saved.bannedMachineIds,
  );
  const [recipeTypes, setRecipeTypes] = useState(saved.recipeTypes);
  const [bannedNeededItems, setBannedNeededItems] = useState<Item[]>(saved.bannedNeededItems);
  const [bannedNeededOreGroups, setBannedNeededOreGroups] = useState<Record<string, string[]>>(saved.bannedNeededOreGroups);
  const [appliedNeededItemIds, setAppliedNeededItemIds] = useState<string[]>([]);
  const bannedNeededItemIds = bannedNeededItems.map(item => item.id);
  const [filterChoices, setFilterChoices] = useState<{
    machines: Item[];
    recipeTypes: string[];
  }>();
  const [filterError, setFilterError] = useState("");
  const [filterAttempt, setFilterAttempt] = useState(0);
  const [excludedRecipes] = useState<string[]>([]);
  const [excludedPlans, setExcludedPlans] = useState<string[]>([]);
  const [result, setResult] = useState<PlannerResult>();
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [searchStartedAt, setSearchStartedAt] = useState<number | null>(null);
  const [searchElapsedSeconds, setSearchElapsedSeconds] = useState(0);
  const [suggestionsFound, setSuggestionsFound] = useState(0);
  const partialSearchResult = useRef<PlannerResult>({ plans: [], examined: 0, limited: true });
  const searchedBanIds = useRef<string[]>([]);
  useEffect(() => {
    if (!busy || searchStartedAt === null) return;
    const timer = window.setInterval(() => setSearchElapsedSeconds(Math.floor((performance.now() - searchStartedAt) / 1000)), 250);
    return () => window.clearInterval(timer);
  }, [busy, searchStartedAt]);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const plan = result?.plans[page];
  const suggestionKey = plan ? JSON.stringify([target?.id, embedded, plan.key, plan.balanceMachines,
    plan.steps.map(step => [step.machineId, step.cycles, step.multiblock])]) : undefined;
  const [readySuggestionKey, setReadySuggestionKey] = useState<string>();
  const activeSuggestion = useRef(suggestionKey);
  activeSuggestion.current = suggestionKey;
  const previewReady = useCallback((key: string) => { if (activeSuggestion.current === key) setReadySuggestionKey(key); }, []);
  const [suggestionGraphs, setSuggestionGraphs] = useState<Record<string, PlannedGraph>>({});

  const baseGraph = useMemo(() => {
    if (!plan) return undefined;
    if (suggestionKey && suggestionGraphs[suggestionKey]) return suggestionGraphs[suggestionKey];
    const graph = plannerGraph(plan);
    if (!embedded && plan.steps.length > 1) {
      const targetItem = plan.steps.flatMap(step => step.recipe.ingredients).find(i => i.direction === 'output' && i.itemId === (plan.targetOutputId ?? target?.id))?.item;
      graph.group = { title: target?.name.replace(/§./g, '') ?? 'Production', targetItem,
        calculators: targetItem ? plannerDefaultCalculators(targetItem, false) : [], fuelDefaultsPending: true };
    }
    return graph;
  }, [plan, embedded, target?.name, suggestionKey, suggestionGraphs]);
  const graph = (suggestionKey ? suggestionGraphs[suggestionKey] : undefined) ?? baseGraph;
  const updateCachedGraph = useCallback((key: string, next: PlannedGraph) => {
    setSuggestionGraphs(current => current[key] === next ? current : { ...current, [key]: next });
  }, []);
  const cacheGraph = (next: PlannedGraph) => { if (suggestionKey) updateCachedGraph(suggestionKey, next); };
  const previewLimits = useMemo(() => ({ allowMultiblocks, balanceMachines, maxTier,
    maxTotalEu: maxTotalEu.trim() === '' ? undefined : Number(maxTotalEu) }), [allowMultiblocks, balanceMachines, maxTier, maxTotalEu]);
  useEffect(() => {
    if (suggestionKey && baseGraph && !suggestionGraphs[suggestionKey]) updateCachedGraph(suggestionKey, baseGraph);
  }, [suggestionKey, baseGraph, suggestionGraphs, updateCachedGraph]);
  const calculatorSummary = useMemo(() => graph ? summarizePlanner(graph) : undefined, [graph]);
  const { families, items: familyItems } = useItemFamilies([...inputs.map(item => item.id), ...bannedNeededItemIds, ...(calculatorSummary?.inputs.map(flow => flow.item.id) ?? [])]);
  const protectedInputIds = new Set(inputs.flatMap(item => families[item.id] ?? [item.id]));
  useEffect(() => {
    setBannedNeededItems(current => current.some(item => protectedInputIds.has(item.id))
      ? current.filter(item => !protectedInputIds.has(item.id)) : current);
  }, [families, inputs]);
  const valid =
    !!target?.id &&
    (maxTotalEu.trim() === '' || (Number.isFinite(Number(maxTotalEu)) && Number(maxTotalEu) >= 0)) &&
    !inputs.some(input => input.id === target.id) &&
    [Number(maxSteps), Number(maxSuggestions)].every(
      (value) => Number.isInteger(value) && value >= 1 && value <= 100,
    );
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (embedded) return;
    try {
      sessionStorage.setItem(
        plannerFiltersKey,
        JSON.stringify({
          target,
          inputs,
          priorities,
          allowMultiblocks,
          balanceMachines,
          maxTier,
          maxTotalEu,
          maxSteps,
          maxSuggestions,
          searchDurationSeconds,
          bannedMachineIds,
          bannedNeededItems,
          bannedNeededOreGroups,
          recipeTypes,
        }),
      );
    } catch {}
  }, [
    embedded,
    target,
    inputs,
    priorities,
    allowMultiblocks,
    balanceMachines,
    maxTier,
    maxTotalEu,
    maxSteps,
    maxSuggestions,
    searchDurationSeconds,
    bannedMachineIds,
    bannedNeededItems,
    bannedNeededOreGroups,
    recipeTypes,
  ]);
  useEffect(() => {
    const request = new AbortController();
    fetch("/api/auto-planner", { signal: request.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok)
          throw new Error(
            data.error || "Could not load machine and recipe type filters.",
          );
        if (!request.signal.aborted) {
          setFilterChoices(data);
          setFilterError("");
        }
      })
      .catch((error) => {
        if (!request.signal.aborted) setFilterError((error as Error).message);
      });
    return () => request.abort();
  }, [filterAttempt]);
  const invalidate = () => {
    controller.current?.abort();
    setBusy(false);
    setResult(undefined);
    setPage(0);
    setError("");
  };
  const stopSearch = (stopReason: 'cancelled' | 'timeout') => {
    controller.current?.abort();
    setBusy(false);
    setResult({ ...partialSearchResult.current, limited: true, stopReason });
    setAppliedNeededItemIds(searchedBanIds.current);
    setPage(0);
  };
  async function search(
    recipeExclusions = excludedRecipes,
    planExclusions = excludedPlans,
  ) {
    if (!valid) return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setBusy(true);
    setSearchStartedAt(performance.now());
    setSearchElapsedSeconds(0);
    setSuggestionsFound(0);
    partialSearchResult.current = { plans: [], examined: 0, limited: true };
    setError("");
    setResult(undefined);
    setPage(0);
    const options: PlannerOptions = {
      targetId: target!.id,
      exactTarget: embedded,
      inputIds: inputs.map(input => input.id),
      priority: "eu",
      priorities,
      allowMultiblocks,
      balanceMachines,
      maxTier,
      maxTotalEu: maxTotalEu.trim() === '' ? undefined : Number(maxTotalEu),
      maxSteps: Number(maxSteps),
      maxSuggestions: Number(maxSuggestions),
      searchDurationSeconds,
      excludedRecipes: recipeExclusions,
      excludedPlans: planExclusions,
      bannedMachineIds,
      bannedNeededItemIds: bannedNeededItems.map(item => item.id),
      recipeTypes,
    };
    searchedBanIds.current = options.bannedNeededItemIds ?? [];
    const deadlineTimer = window.setTimeout(() => {
      if (controller.current === current && !current.signal.aborted) stopSearch('timeout');
    }, searchDurationSeconds * 1000);
    try {
      const response = await fetch("/api/auto-planner", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/x-ndjson" },
        body: JSON.stringify(options),
        signal: current.signal,
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Could not search recipes.');
      }
      const data = await readPlannerResultStream(response, progress => {
        if (current.signal.aborted || controller.current !== current) return;
        partialSearchResult.current = progress;
        setSuggestionsFound(progress.plans.length);
      });
      if (!current.signal.aborted) {
        setResult(data);
        setAppliedNeededItemIds(options.bannedNeededItemIds ?? []);
      }
    } catch (error) {
      if (!current.signal.aborted) setError((error as Error).message);
    } finally {
      window.clearTimeout(deadlineTimer);
      if (!current.signal.aborted) setBusy(false);
    }
  }
  const changeNeededBans = (items: Item[]) => {
    const remaining = new Set(items.map(item => item.id));
    setBannedNeededOreGroups(current => Object.fromEntries(Object.entries(current).map(([name, ids]) => [name, ids.filter(id => remaining.has(id))] as const).filter(([, ids]) => ids.length > 0)));
    setBannedNeededItems([...new Map(items.filter(item => !protectedInputIds.has(item.id)).map(item => [item.id, item])).values()]);
  };
  const choose = (item: Item) => {
    invalidate();
    if (picker === "target") setTarget(item);
    else {
      setInputs(current => current.some(input => input.id === item.id) ? current : [...current, item]);
      setBannedNeededItems(current => current.filter(banned => !(families[item.id] ?? [item.id]).includes(banned.id)));
    }
    setPicker(null);
  };
  return (
    <div className={embedded ? "planner-inline nodrag nopan nowheel" : "modal-backdrop"} onClick={embedded ? undefined : onClose}>
      <section
        className="dialog auto-planner-dialog"
        role="dialog"
        aria-modal={!embedded}
        aria-label="Auto Wizzard"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            if (picker) setPicker(null);
            else onClose();
          }
        }}
      >
        <div className="recipe-browser-heading item-picker-heading">
          <div className="recipe-view">
            <h2 className="recipe-title">
              <span className="item-slot">
                <WandSparkles size={24} />
              </span>
              <span>
                Auto Wizzard
              </span>
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close Auto Wizzard"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
          <div className="planner-layout">
            <form
              className="planner-options settings-section"
              onSubmit={(event) => {
                event.preventDefault();
                void search();
              }}
            >
            <p className="planner-explanation">
              Choose a target to compare recipes. Add inputs to find production routes.
            </p>
              <h3>Items</h3>
              <div className="planner-input-list">
                <span>Input items (optional)</span>
                <div className="planner-input-values">
                {inputs.map(input => (
                  <div className="planner-input-choice" key={input.id}>
                    <span className="planner-selected-input">
                      {input.image && <img src={input.image} alt="" />}
                      {input.name.replace(/§./g, "")}
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${input.name.replace(/§./g, "")} input`}
                      onClick={() => {
                        invalidate();
                        setInputs(current => current.filter(value => value.id !== input.id));
                      }}
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
                <button type="button" className="planner-item-choice" disabled={inputs.length >= 100} onClick={() => setPicker("input")}>
                  <Plus size={16} /> Add input item
                </button>
                </div>
              </div>
              <label>
                <span>Target item</span>
                <button
                  type="button"
                  className="planner-item-choice"
                  onClick={() => setPicker("target")}
                >
                  {target?.image && <img src={target.image} alt="" />}
                  <span>{target?.name.replace(/§./g, "") ?? "Choose target item"}</span>
                  <Search size={16} />
                </button>
              </label>
              <h3>Recipes / machines</h3>
              <PlannerFilterDropdown
                  label="Maximum machine tier"
                  emptyLabel="Choose tier"
                  singleSelect
                  items={machineTiers.map((tier, index) => ({ id: String(index), name: tier }))}
                  selected={[String(maxTier)]}
                  onChange={([value]) => {
                    invalidate();
                    setMaxTier(Number(value));
                  }}
              />
              <label title="Maximum operating EU required to produce one target item or 1,000 mB of target fluid, using the selected machine ratios. Leave blank for no limit.">
                <span>Max total EU per item / 1000 mB</span>
                <span className="planner-eu-input">
                  <input type={editingMaxTotalEu ? 'number' : 'text'} inputMode="decimal" min={0} step="any" placeholder="No limit" aria-label="Max total EU per item / 1000 mB"
                    value={editingMaxTotalEu || maxTotalEu.trim() === '' ? maxTotalEu : Number(maxTotalEu).toLocaleString('de-DE', { maximumSignificantDigits: 21 })}
                    onFocus={() => setEditingMaxTotalEu(true)} onBlur={() => setEditingMaxTotalEu(false)}
                    onChange={event => { invalidate(); setMaxTotalEu(event.target.value); }} />
                  <span aria-hidden="true">EU</span>
                </span>
              </label>
              <PlannerFilterDropdown
                label="Banned machines"
                emptyLabel="No machines banned"
                loading={!filterChoices && !filterError}
                items={(filterChoices?.machines ?? []).map((machine) => ({
                  id: machine.id,
                  name: machine.name,
                  machine,
                }))}
                selected={bannedMachineIds}
                onChange={(ids) => {
                  invalidate();
                  setBannedMachineIds(ids);
                }}
              />
              <PlannerFilterDropdown
                label="Allowed recipe types"
                emptyLabel="All recipe types"
                loading={!filterChoices && !filterError}
                items={(filterChoices?.recipeTypes ?? []).map((name) => ({
                  id: name,
                  name,
                }))}
                selected={recipeTypes}
                onChange={(ids) => {
                  invalidate();
                  setRecipeTypes(ids);
                }}
              />
              <label className="planner-checkbox settings-switch-row">
                <span>Allow multiblock structures</span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={allowMultiblocks}
                  onChange={(event) => {
                    invalidate();
                    setAllowMultiblocks(event.target.checked);
                  }}
                />
              </label>
              <label className="planner-checkbox settings-switch-row" title="Balance recipe machine counts before comparison. Turn off to compare one machine per recipe; inputs may then be partially supplied.">
                <span>Balance machine ratios</span>
                <input type="checkbox" role="switch" checked={balanceMachines} onChange={event => { invalidate(); setBalanceMachines(event.target.checked); }} />
              </label>
              <h3>Search options</h3>
              <PlannerPriorityList values={priorities} hasInputs={inputs.length > 0}
                onChange={values => { invalidate(); setPriorities(values); }} />
              <label>
                <span>Maximum recipe steps</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  value={maxSteps}
                  onChange={(event) => {
                    invalidate();
                    setMaxSteps(event.target.value);
                  }}
                />
              </label>
              <label>
                <span>Maximum suggestions</span>
                <input
                  type="number"
                  min={1}
                  max={100}
                  step={1}
                  value={maxSuggestions}
                  onChange={(event) => {
                    invalidate();
                    const value = event.target.value;
                    setMaxSuggestions(value === '' ? '' : String(Math.max(1, Math.min(100, Math.trunc(Number(value)) || 1))));
                  }}
                  onBlur={() => { if (!maxSuggestions) setMaxSuggestions('1'); }}
                />
              </label>
              {filterError && (
                <div role="alert">
                  {filterError}
                  <button
                    type="button"
                    onClick={() => setFilterAttempt((value) => value + 1)}
                  >
                    Retry loading filters
                  </button>
                </div>
              )}
              <button type="submit" className="primary" disabled={!valid || busy}>
                <Search size={16} />
                {busy ? `Searching…${searchElapsedSeconds >= 5 ? ` ${Math.floor(searchElapsedSeconds / 60)}:${String(searchElapsedSeconds % 60).padStart(2, '0')} · ${suggestionsFound} suggestions found` : ''}` : "Find suggestions"}
              </button>
              {busy && (
                <button type="button" onClick={() => stopSearch('cancelled')}>
                  Cancel search
                </button>
              )}

            </form>
            <div className="planner-main">
            {error && <p role="alert">{error}</p>}
            {result?.limited && (
              <p className="planner-notice" role="status">
                {result.stopReason === 'cancelled'
                  ? `Search cancelled. ${result.plans.length} suggestions found.`
                  : result.stopReason === 'timeout'
                  ? `Max search duration reached. ${result.plans.length} suggestions found.`
                  : result.plans.length
                  ? 'Search limit reached. Showing the routes found so far; other valid routes may exist.'
                  : 'Search limit reached before a matching route was found. This does not mean no valid route exists.'}
              </p>
            )}
            {result && !plan && !result.limited && (
              <p role="status">
                No matching routes found within these limits. Try another input,
                tier, or step limit.
              </p>
            )}
            {!plan && bannedNeededItems.length > 0 && <PlannerNeededBans oreGroups={bannedNeededOreGroups} familyItems={familyItems} inputItemIds={[...protectedInputIds]} onAddVariants={ids => changeNeededBans([...bannedNeededItems, ...ids.flatMap(id => familyItems[id] ? [familyItems[id]] : [])])} onRemoveGroup={ids => changeNeededBans(bannedNeededItems.filter(item => !ids.includes(item.id)))} onClear={() => changeNeededBans([])} families={families} items={bannedNeededItems} appliedItemIds={appliedNeededItemIds} onRemove={id => changeNeededBans(bannedNeededItems.filter(item => item.id !== id))} />}
            {plan && graph && (
              <>
                <div className="planner-results-toolbar">
                  <button
                    type="button"
                    className="primary"
                    aria-label="Previous suggestion"
                    disabled={result!.plans.length < 2}
                    onClick={() =>
                      setPage(
                        (page + result!.plans.length - 1) %
                          result!.plans.length,
                      )
                    }
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <span>
                    Suggestion {page + 1} / {result!.plans.length}
                  </span>
                  <button
                    type="button"
                    className="primary"
                    aria-label="Next suggestion"
                    disabled={result!.plans.length < 2}
                    onClick={() => setPage((page + 1) % result!.plans.length)}
                  >
                    <ChevronRight size={18} />
                  </button>
                  <PlannerNeededBans oreGroups={bannedNeededOreGroups} familyItems={familyItems} inputItemIds={[...protectedInputIds]} onAddVariants={ids => changeNeededBans([...bannedNeededItems, ...ids.flatMap(id => familyItems[id] ? [familyItems[id]] : [])])} onRemoveGroup={ids => changeNeededBans(bannedNeededItems.filter(item => !ids.includes(item.id)))} onClear={() => changeNeededBans([])} families={families} items={bannedNeededItems} appliedItemIds={appliedNeededItemIds} onRemove={id => changeNeededBans(bannedNeededItems.filter(item => item.id !== id))} />
                  <button
                    type="button"
                    onClick={() => {
                      const next = [...excludedPlans, plan.key];
                      setExcludedPlans(next);
                      void search(excludedRecipes, next);
                    }}
                  >
                    <Ban size={16} />
                    Disregard suggestion
                  </button>
                </div>
              </>
            )}
            <div className={`planner-preview${embedded ? " planner-preview-embedded" : ""}${calculatorSummary?.inputs.some(flow => !calculatorSummary.recursiveInputIds.includes(flow.item.id) && !bannedNeededItemIds.includes(flow.item.id)) ? " planner-has-needed" : ""}`} style={{ zoom: 1 / parentZoom, width: "100%" }}>
              <OverviewZoomOverride value={previewOverviewZoom}>
              {calculatorSummary && <PlannerNeededItems onBanOreGroup={(items, groups) => { changeNeededBans([...bannedNeededItems, ...items]); setBannedNeededOreGroups(current => ({ ...current, ...groups })); }} summary={calculatorSummary} hiddenItemIds={bannedNeededItemIds} inputItemIds={[...protectedInputIds]} families={families} inputsReady={inputs.every(item => !!families[item.id])} onBanAll={item => changeNeededBans([...bannedNeededItems, ...(families[item.id] ?? []).flatMap(id => familyItems[id] ? [familyItems[id]] : [])])} onBan={item => changeNeededBans([...bannedNeededItems.filter(value => value.id !== item.id), item])} />}
              {!embedded && calculatorSummary && !!graph?.group?.calculators?.length && <PlannerCalculatorResults summary={calculatorSummary} calculators={graph.group.calculators} />}
              {Object.entries(suggestionKey && graph ? { ...suggestionGraphs, [suggestionKey]: graph } : suggestionGraphs).map(([key, cachedGraph]) =>
                <CachedSuggestionPreview key={key} cacheKey={key} graph={cachedGraph} active={key === suggestionKey}
                  machineLimits={previewLimits} onChange={updateCachedGraph} onReady={previewReady} />)}
              {suggestionKey && readySuggestionKey !== suggestionKey && <div className="planner-loading-overlay" aria-busy="true" onClick={event => event.stopPropagation()}>
                <section className="dialog diagram-loading-dialog" role="status" aria-label="Loading suggestion">
                  <h2>Loading suggestion</h2>
                  <p>Preparing diagram…</p>
                  <DiagramLoadingProgress key={suggestionKey} />
                </section>
              </div>}
              {!suggestionKey && <ReactFlowProvider><PlannerPreview graph={emptyPreviewGraph} machineLimits={previewLimits} onChange={() => {}} /></ReactFlowProvider>}
              </OverviewZoomOverride>
              {!embedded && !!graph?.nodes.length && <label className="planner-overview-slider nodrag nopan nowheel" title="Show the zoomed-out view below this zoom level">
                <span>Zoomed-out view</span>
                <input type="range" min={0} max={100} step={5} value={Math.round(previewOverviewZoom * 100)}
                  aria-label="Zoomed-out view threshold" onChange={event => setOverviewZoom(Number(event.target.value) / 100)} />
                <span>{Math.round(previewOverviewZoom * 100)}%</span>
              </label>}
            </div>
            <div className="planner-preview-actions">
              {!embedded && graph?.group && <button type="button" className="primary" onClick={() => {
                cacheGraph({ ...graph, group: undefined });
              }}><X size={16} />Remove group</button>}
              <button type="button" className="primary" disabled={!plan || !graph?.nodes.length || busy} onClick={() => { if (graph) onAdd(graph); }}>
                <Plus size={16} />{embedded ? "Confirm branch" : "Add to diagram"}
              </button>
              {!embedded && <button type="button" className="primary" aria-label="Add to diagram and keep wizard open" title="Add to diagram and keep wizard open"
                disabled={!plan || !graph?.nodes.length || busy} onClick={() => { if (graph) onAdd(graph, true); }}><Plus size={16} /></button>}
            </div>
            </div>
          </div>
      </section>
      {picker && createPortal(
        <div className="modal-backdrop planner-picker-backdrop nodrag nopan nowheel"
          onPointerDown={event => event.stopPropagation()}
          onClick={event => { event.stopPropagation(); setPicker(null); }}
          onKeyDown={event => {
            event.stopPropagation();
            if (event.key === "Escape") setPicker(null);
          }}>
          <section className="dialog item-picker-dialog" role="dialog" aria-modal="true"
            aria-label={`Choose ${picker} item`} onClick={event => event.stopPropagation()}>
            <div className="dialog-heading">
              <h2>Choose {picker} item</h2>
              <button type="button" autoFocus aria-label="Close item picker" onClick={() => setPicker(null)}><X size={20} /></button>
            </div>
            <Inventory picker onBrowse={choose} onAddItem={choose} />
          </section>
        </div>, document.body,
      )}
    </div>
  );
}
