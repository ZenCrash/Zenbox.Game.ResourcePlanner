"use client";
import { useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ReactFlow, Controls, ViewportPortal, applyNodeChanges, useReactFlow, useStore, getViewportForBounds } from "@xyflow/react";
import { WandSparkles } from "lucide-react";
import { MachineCard, EditorContext } from "./machine-card";
import { GridEdge, type DiagramEdge } from "./grid-edge";
import { GridBackground } from "./grid-background";
import { ItemSlot } from "./recipe-view";
import { AutoRecipePlanner, type PlannedGraph, type PlannedNode } from "./auto-recipe-planner";
import { applyVariants, itemColor, port, rate, supplyColor, connectionColors, hasRecipeTiming, type Item } from "@/lib/model";
import { overclockRecipe } from "@/lib/recipe-overclock";
import { connectionSummary } from "@/lib/connection-summary";
import { fluidReferenceFlow } from "@/lib/fluid-reference";
import { appendPlannerBranch } from "@/lib/planner-branch";
import { useDisplaySettings } from "./display-settings";
import { initialRoute } from "@/lib/initial-route";
import { PlannerWindow } from "./planner-window";
import { SummaryAreaView, type SummaryAreaData } from "./summary-area";
import type { Node, NodeProps, NodeChange, Viewport } from "@xyflow/react";
import { plannerGroupNode } from "@/lib/planner-group";
import { summarizePlanner, plannerItemPortState, setPlannerItemDisabled } from '@/lib/planner-summary';
import { plannerPreviewBounds } from '@/lib/planner-preview-bounds';
import { useFuelValues } from './use-fuel-values';
import { plannerDefaultCalculators } from '@/lib/planner-calculators';


function PlannerGroup({ data }: NodeProps<Node<SummaryAreaData & { measureHeader: (height: number) => void }>>) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const header = ref.current?.querySelector('.summary-area-header');
    if (!header) return;
    const content = ref.current?.querySelector('.summary-area-content');
    const measure = () => data.measureHeader((header as HTMLElement).offsetHeight + (content ? (content as HTMLElement).scrollHeight : 0));
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    if (content) observer.observe(content);
    measure();
    return () => observer.disconnect();
  }, [data.measureHeader, data.summary, data.calculators]);
  return <div ref={ref} style={{ width: '100%', height: '100%' }}><SummaryAreaView data={data} /></div>;
}
const nodeTypes = { recipe: MachineCard, summary: PlannerGroup };
const edgeTypes = { grid: GridEdge };
type IngredientTarget = { nodeId: string; slot: number; item: Item };

export function PlannerPreview({ graph, onChange, machineLimits, initialViewport, onViewportChange, active = true, onReady }: { onReady?: () => void; active?: boolean; initialViewport?: Viewport; onViewportChange?: (viewport: Viewport) => void; graph: PlannedGraph; onChange: (graph: PlannedGraph) => void; machineLimits: { allowMultiblocks: boolean; maxTier: number; maxTotalEu?: number; balanceMachines?: boolean } }) {
  const wheelBoundary = `planner-wheel-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const inherited = useContext(EditorContext);
  const { settings } = useDisplaySettings();
  const flow = useReactFlow();
  const [menu, setMenu] = useState<{ x: number; y: number; targets: IngredientTarget[] }>();
  const [branch, setBranch] = useState<IngredientTarget & { x: number; y: number }>();
  const [error, setError] = useState("");
  useEffect(() => { if (!active) { setMenu(undefined); setBranch(undefined); } }, [active]);
  const previewContainer = useRef<HTMLDivElement>(null);
  const latest = useRef({ graph, onChange });
  latest.current = { graph, onChange };
  const targetFuel = useFuelValues(graph.group?.targetItem ? [graph.group.targetItem.id] : []);
  useEffect(() => {
    const { graph, onChange } = latest.current;
    const target = graph.group?.targetItem;
    if (!graph.group?.fuelDefaultsPending || !target || !targetFuel[target.id]) return;
    onChange({ ...graph, group: { ...graph.group, fuelDefaultsPending: false, calculators: plannerDefaultCalculators(target, true) } });
  }, [targetFuel, graph.group?.targetItem?.id, graph.group?.fuelDefaultsPending]);
  const measureHeader = useCallback((height: number) => {
    const { graph, onChange } = latest.current;
    if (graph.group && graph.group.headerHeight !== height) onChange({ ...graph, group: { ...graph.group, headerHeight: height } });
  }, []);
  const viewportWidth = useStore(state => state.width);
  const viewportHeight = useStore(state => state.height);
  const initiallyFitted = useRef(!!initialViewport);
  const readiness = useRef({ active, onReady });
  readiness.current = { active, onReady };
  useEffect(() => {
    if (!active || !initiallyFitted.current) return;
    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => readiness.current.onReady?.()); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
  }, [active]);
  const bounds = plannerPreviewBounds(graph);
  const readyToFit = !!bounds && (!graph.group || graph.nodes.length < 2 || graph.group.headerHeight !== undefined);
  const fitKey = readyToFit ? JSON.stringify(bounds) : '';
  useEffect(() => {
    if (!active || initiallyFitted.current || !flow.viewportInitialized || !fitKey || !viewportWidth || !viewportHeight) return;
    // Depend on geometry, not render/update callbacks: dimension notifications
    // must not continually cancel the initial fit, and React Flow must not race it.
    const timer = window.setTimeout(() => {
      const viewport = getViewportForBounds(JSON.parse(fitKey), viewportWidth, viewportHeight, .001, 1, .15);
      void flow.setViewport(viewport, { duration: 0 }).then(fitted => {
        if (fitted) {
          initiallyFitted.current = true;
          onViewportChange?.(viewport);
          requestAnimationFrame(() => requestAnimationFrame(() => {
            if (readiness.current.active) readiness.current.onReady?.();
          }));
        }
      });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [active, fitKey, viewportWidth, viewportHeight, flow, flow.viewportInitialized]);
  const group = plannerGroupNode(graph);
  const displayNodes: Node[] = group ? [{ ...group, data: { ...group.data,
    measureHeader,
    defaultHeaderTheme: true,
    summary: summarizePlanner(graph),
    updateTheme: (theme: NonNullable<PlannedGraph['group']>['theme']) => { if (graph.group) onChange({ ...graph, group: { ...graph.group, theme } }); },
    updateCalculators: (calculators: NonNullable<PlannedGraph['group']>['calculators']) => { if (graph.group) onChange({ ...graph, group: { ...graph.group, calculators, fuelDefaultsPending: false } }); },
    selectRecipes: () => onChange({ ...graph, nodes: graph.nodes.map(node => ({ ...node, selected: true })) }),
    setItemIgnored: (itemId: string, ignored: boolean) => onChange({ ...graph, ignoredItems: ignored ? [...new Set([...(graph.ignoredItems ?? []), itemId])] : (graph.ignoredItems ?? []).filter(id => id !== itemId) }),
    itemPortState: (itemId: string) => plannerItemPortState(graph, itemId),
    setItemDisabled: (itemId: string, disabled: boolean) => onChange(setPlannerItemDisabled(graph, itemId, disabled)),
    updateTitle: (title: string) => { if (graph.group) onChange({ ...graph, group: { ...graph.group, title } }); },
    removeArea: () => onChange({ ...graph, group: undefined }),
  } }, ...graph.nodes] : graph.nodes;
  useEffect(() => {
    if (!graph.nodes.every(n => n.measured?.width && n.measured?.height)) return;
    let changed = false;
    const edges = graph.edges.map(edge => {
      if (edge.data?.waypoints) return edge;
      const source = flow.getInternalNode(edge.source), target = flow.getInternalNode(edge.target);
      const a = source?.internals.handleBounds?.source?.find(h => h.id === edge.sourceHandle);
      const b = target?.internals.handleBounds?.target?.find(h => h.id === edge.targetHandle);
      if (!source || !target || !a || !b) return edge;
      changed = true;
      const waypoints = initialRoute(
        { x: source.position.x + a.x + a.width / 2, y: source.position.y + a.y + a.height / 2 },
        { x: target.position.x + b.x + b.width / 2, y: target.position.y + b.y + b.height / 2 },
        source.id, target.id, graph.nodes.map(n => ({ id: n.id, ...n.position, width: n.measured!.width!, height: n.measured!.height! })),
      );
      return { ...edge, data: { ...edge.data, waypoints } };
    });
    if (changed) onChange({ ...graph, edges });
  }, [graph, flow, onChange]);
  const connected = new Set(graph.edges.flatMap(e => [`${e.source}/${e.sourceHandle}`, `${e.target}/${e.targetHandle}`]));
  const updateNode = (id: string, patch: Record<string, unknown>) => onChange({ ...graph, nodes: graph.nodes.map(n => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n) });
  const recipeFor = (id: string) => {
    const node = graph.nodes.find(n => n.id === id)!;
    return overclockRecipe(applyVariants(node.data.recipe, node.data.variants), node.data.machineId, node.data.multiblock);
  };
  const edges: DiagramEdge[] = graph.edges.map(edge => {
    const source = graph.nodes.find(n => n.id === edge.source)!;
    const target = graph.nodes.find(n => n.id === edge.target)!;
    const sr = recipeFor(source.id), tr = recipeFor(target.id);
    const output = port(sr, edge.sourceHandle!), input = port(tr, edge.targetHandle!);
    if (!output || !input) return edge as DiagramEdge;
    const summary = connectionSummary(output, sr, source.data.machines, input, tr, target.data.machines);
    const reference = edge.data?.reference ? fluidReferenceFlow(output, sr, source.data.machines, input, tr, target.data.machines) : undefined;
    const supplied = graph.edges.filter(e => e.target === edge.target && e.targetHandle === edge.targetHandle && !e.data?.reference).reduce((total, e) => {
      const n = graph.nodes.find(n => n.id === e.source)!;
      const r = recipeFor(n.id), ingredient = port(r, e.sourceHandle!);
      return total + (ingredient ? rate(ingredient, r, n.data.machines) : 0);
    }, 0);
    return { ...edge, type: "grid", data: { ...edge.data, item: output.item,
      setCardVisible: (overview, visible) => onChange({ ...graph, edges: graph.edges.map(e => e.id === edge.id ? { ...e, data: { ...e.data, [overview ? "showOverviewCard" : "showLineCard"]: visible } } : e) }),
      moveLabel: (id, point, mode) => onChange({ ...graph, edges: graph.edges.map(e => e.id === id ? { ...e, data: { ...e.data, [mode ? "imagePosition" : "labelPosition"]: point } } : e) }),
      movePoints: (id, points) => onChange({ ...graph, edges: graph.edges.map(e => e.id === id ? { ...e, data: { ...e.data, waypoints: points, labelPosition: undefined, imagePosition: undefined } } : e) }),
    }, style: { stroke: reference?.color ?? (hasRecipeTiming(tr) ? supplyColor(supplied, rate(input, tr, target.data.machines)) : connectionColors.unrated), strokeWidth: settings.lineThickness },
    label: <><div className="connection-card-heading" data-planner-target={edge.target} data-planner-slot={input.slot}><span className={`connection-card-image${output.item.kind === "fluid" ? " fluid" : ""}`}><ItemSlot item={output.item} tooltipAtPointer /></span><div className="connection-card-heading-text"><strong className="connection-item">{summary.item}</strong><div className="connection-ratio">{reference ? `${reference.liters} L / container` : summary.ratio}</div></div></div><div className="connection-rates"><strong>{summary.from}</strong><span>→</span><strong>{summary.target}</strong></div></> as ReactNode };
  });
  return <EditorContext.Provider value={{ ...inherited, browse: () => {}, connected, selectedConnections: new Map(), color: itemColor,
    count: (id, machines) => updateNode(id, { machines }), selectMachine: (id, machineId) => updateNode(id, { machineId }),
    configureMultiblock: (id, multiblock) => updateNode(id, { multiblock }),
    movePorts: (id, portRows) => updateNode(id, { portRows }), togglePort: () => {},
    disconnect: id => onChange({ ...graph, edges: graph.edges.filter(e => e.id !== id) }),
    remove: id => onChange({ ...graph, nodes: graph.nodes.filter(n => n.id !== id), edges: graph.edges.filter(e => e.source !== id && e.target !== id) }),
  }}>
    <div ref={previewContainer} style={{ height: "100%" }} onPointerDown={() => setMenu(undefined)} onContextMenuCapture={event => {
      const element = event.target as HTMLElement;
      if (element.closest(".planner-inline")) return;
      const lineItem = element.closest("[data-planner-target]");
      const nodeId = lineItem?.getAttribute("data-planner-target") ?? element.closest(".react-flow__node")?.getAttribute("data-id");
      const itemId = element.closest("[data-item-id]")?.getAttribute("data-item-id");
      const node = graph.nodes.find(n => n.id === nodeId);
      if (!node) return;
      const targets = recipeFor(node.id).ingredients.filter(i => i.direction === "input" && i.amount > 0 && (lineItem ? i.slot === Number(lineItem.getAttribute("data-planner-slot")) : !itemId || i.itemId === itemId)).map(i => ({ nodeId: node.id, slot: i.slot, item: i.item }));
      if (!targets.length) return;
      event.preventDefault(); event.stopPropagation();
      setMenu({ x: event.clientX, y: event.clientY, targets });
    }}>
      <ReactFlow defaultViewport={initialViewport} onMoveEnd={(_, viewport) => onViewportChange?.(viewport)} nodes={displayNodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        noWheelClassName={wheelBoundary}
        onNodesChange={changes => onChange({ ...graph, nodes: applyNodeChanges<PlannedNode>(changes.filter(change => change.type !== "add" && change.type !== "replace" && change.id !== "planner-group") as NodeChange<PlannedNode>[], graph.nodes) })}
        minZoom={.001} maxZoom={2}
        nodesConnectable={false} deleteKeyCode={null} colorMode="dark" panOnDrag={[1]}>
        <GridBackground />{graph.nodes.length > 0 && <Controls showInteractive={false} />}
        {branch && <ViewportPortal><PlannerWindow key={`${branch.nodeId}/${branch.slot}`} x={branch.x} y={branch.y} wheelBoundary={wheelBoundary}>
          {error && <p role="alert">{error}</p>}
          <AutoRecipePlanner key={`${branch.nodeId}/${branch.slot}`} embedded initialMachineLimits={machineLimits} initialTarget={branch.item} onClose={() => setBranch(undefined)} onAdd={addition => {
            try { onChange(appendPlannerBranch(graph, addition, branch.nodeId, branch.slot, crypto.randomUUID())); setBranch(undefined); setError(""); requestAnimationFrame(() => flow.fitView({ padding: .15 })); }
            catch (e) { setError((e as Error).message); }
          }} />
        </PlannerWindow></ViewportPortal>}
      </ReactFlow>
    </div>
    {menu && createPortal(<div role="menu" className="diagram-selection-menu line-context-menu planner-context-menu" style={{ position: "fixed", left: Math.min(menu.x, window.innerWidth - 300), top: Math.min(menu.y, window.innerHeight - 180), zIndex: 100000 }} onPointerDown={e => e.stopPropagation()}>
      {menu.targets.map(t => <button role="menuitem" key={t.slot} onClick={() => { const node = graph.nodes.find(n => n.id === t.nodeId)!; setBranch({ ...t, x: node.position.x - 1200, y: node.position.y }); setMenu(undefined); setError(""); void flow.setCenter(node.position.x - 650, node.position.y + 300, { zoom: .65, duration: 250 }); }}><WandSparkles size={16} />Plan production of {t.item.name.replace(/§./g, "")}</button>)}
    </div>, document.body)}
  </EditorContext.Provider>;
}
