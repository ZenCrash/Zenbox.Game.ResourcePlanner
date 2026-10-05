"use client";
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Ban, ChevronDown, CodeXml, X } from 'lucide-react';
import type { Item } from '@/lib/model';
import type { AreaSummary } from '@/lib/area-summary';
import { ItemSlot } from './recipe-view';

const name = (item: Item) => item.name.replace(/§[0-9a-fk-or]/gi, '');
type OreGroupData = { groups: string[]; groupItemIds: Record<string, string[]>; items: Item[] };

export function PlannerNeededItems({ summary, hiddenItemIds, inputItemIds, families, inputsReady, onBan, onBanAll, onBanOreGroup }: { summary: AreaSummary; hiddenItemIds: string[]; inputItemIds: string[]; families: Record<string, string[]>; inputsReady: boolean; onBan: (item: Item) => void; onBanAll: (item: Item) => void; onBanOreGroup: (items: Item[], groups: Record<string, string[]>) => void }) {
  const menu = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Item>();
  const oreCache = useRef(new Map<string, OreGroupData>());
  const [oreData, setOreData] = useState<OreGroupData & { id: string }>();
  const [oreError, setOreError] = useState<string>();
  useEffect(() => {
    setOreError(undefined);
    if (!selected) return;
    const cached = oreCache.current.get(selected.id);
    if (cached) { setOreData({ id: selected.id, ...cached }); return; }
    const controller = new AbortController();
    void fetch('/api/item-ore-groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(selected.id), signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Ore dictionary lookup failed');
        const data: OreGroupData = await response.json();
        if (controller.signal.aborted) return;
        oreCache.current.set(selected.id, data);
        setOreData({ id: selected.id, ...data });
      }).catch(() => { if (!controller.signal.aborted) setOreError('Could not load ore dictionary groups'); });
    return () => controller.abort();
  }, [selected]);
  const currentOreData = oreData?.id === selected?.id ? oreData : undefined;
  const needed = summary.inputs.filter(flow => !summary.recursiveInputIds.includes(flow.item.id) && !hiddenItemIds.includes(flow.item.id));
  if (!needed.length) return null;
  return <aside className="planner-needed-items nodrag nopan nowheel" aria-label="Needed items">
    {needed.map(flow => <div key={flow.item.id} className="planner-needed-item" onContextMenu={event => {
      event.preventDefault(); event.stopPropagation();
      if (!inputsReady || !families[flow.item.id] || families[flow.item.id].some(id => inputItemIds.includes(id))) { menu.current?.hidePopover(); return; }
      setSelected(flow.item);
      if (menu.current) {
        menu.current.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - 260))}px`;
        menu.current.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - 160))}px`;
        menu.current.style.maxHeight = `${window.innerHeight - parseFloat(menu.current.style.top) - 8}px`;
        menu.current.style.overflowY = 'auto';
        menu.current.showPopover();
      }
    }}>
      <span className="summary-rate-resource-label summary-rate-resource-amount" data-fluid={flow.item.kind === 'fluid' || undefined}>
        <ItemSlot item={flow.item} tooltipAtPointer />
        <span>{name(flow.item)}</span>
      </span>
      <span className="summary-rate-resource-amount">{flow.rate.toLocaleString('de-DE', { maximumFractionDigits: 4 })} <span className="summary-rate-resource-unit">{flow.item.kind === 'fluid' ? 'mB/s' : 'items/s'}</span></span>
    </div>)}
    <div ref={menu} popover="auto" role="menu" className="diagram-selection-menu planner-needed-menu">
      <button type="button" role="menuitem" onClick={() => { menu.current?.hidePopover(); if (selected) onBan(selected); }}><Ban size={14} />Not allowed to be needed</button>
      {selected && (families[selected.id]?.length ?? 0) > 1 && <button type="button" role="menuitem" onClick={() => { menu.current?.hidePopover(); onBanAll(selected); }}><Ban size={14} />Not allowed to be needed for all variants</button>}
      {selected && (!currentOreData || currentOreData.groups.length > 0) && <hr className="planner-needed-menu-separator" />}
      {selected && currentOreData?.groups.map(group => <button key={group} type="button" role="menuitem" disabled={!inputsReady} onClick={() => {
        const ids = new Set(currentOreData.groupItemIds[group]);
        menu.current?.hidePopover();
        onBanOreGroup(currentOreData.items.filter(item => ids.has(item.id) && !inputItemIds.includes(item.id)), { [group]: [...ids] });
      }}><Ban size={14} />Not allowed to be needed: {group}</button>)}
      {selected && (!currentOreData || currentOreData.groups.length > 0) && <button type="button" role="menuitem" disabled={!currentOreData || currentOreData.groups.length < 2 || !inputsReady} title={currentOreData?.groups.join(', ')} onClick={() => {
        if (!currentOreData || currentOreData.groups.length < 2) return;
        menu.current?.hidePopover();
        onBanOreGroup(currentOreData.items.filter(item => !inputItemIds.includes(item.id)), currentOreData.groupItemIds);
      }}><Ban size={14} />{oreError || (!currentOreData ? 'Loading ore dictionary groups…' : 'Not allowed to be needed for all ore dictionary groups')}</button>}
    </div>
  </aside>;
}

export function PlannerNeededBans({ oreGroups, items, families, familyItems, inputItemIds, onAddVariants, appliedItemIds, onRemove, onRemoveGroup, onClear }: { oreGroups: Record<string, string[]>; items: Item[]; families: Record<string, string[]>; familyItems: Record<string, Item>; inputItemIds: string[]; onAddVariants: (ids: string[]) => void; appliedItemIds: string[]; onRemove: (id: string) => void; onRemoveGroup: (ids: string[]) => void; onClear: () => void }) {
  const menu = useRef<HTMLDivElement>(null);
  const variantMenu = useRef<HTMLDivElement>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const [variantItemId, setVariantItemId] = useState<string>();
  const missingVariants = (id: string) => {
    const family = families[id] ?? [];
    if (family.some(member => inputItemIds.includes(member))) return [];
    return family.filter(member => !items.some(item => item.id === member));
  };
  const openVariantMenu = (event: MouseEvent, id: string) => {
    event.preventDefault(); event.stopPropagation();
    variantMenu.current?.hidePopover();
    if (!missingVariants(id).length) return;
    setVariantItemId(id);
    if (variantMenu.current) {
      variantMenu.current.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - 300))}px`;
      variantMenu.current.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - 60))}px`;
      variantMenu.current.showPopover();
    }
  };
  const groups = new Map<string, Item[]>();
  const oreNames = new Map<string, string>();
  const groupedIds = new Set<string>();
  for (const [group, ids] of Object.entries(oreGroups)) {
    const allowedIds = new Set(ids);
    const members = items.filter(item => allowedIds.has(item.id));
    if (!members.length) continue;
    const key = 'ore:' + group;
    groups.set(key, members);
    oreNames.set(key, group);
    members.forEach(item => groupedIds.add(item.id));
  }
  for (const item of items) {
    if (groupedIds.has(item.id)) continue;
    const key = families[item.id]?.slice().sort()[0] ?? item.id;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return <div className="planner-needed-bans">
    <button type="button" aria-haspopup="menu" onClick={event => {
      setCopyStatus('');
      if (!menu.current) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      menu.current.style.left = `${Math.max(8, Math.min(bounds.left, window.innerWidth - 320))}px`;
      menu.current.style.top = `${bounds.bottom + 4}px`;
      menu.current.showPopover();
    }}>Not allowed to be needed ({items.length})<ChevronDown size={14} /></button>
    <div ref={menu} popover="auto" className="diagram-selection-menu planner-needed-menu" aria-label="Items not allowed to be needed">
      {process.env.NODE_ENV === 'development' && <button type="button" className="planner-needed-copy" disabled={!items.length} onClick={async () => {
        try {
          await navigator.clipboard.writeText(items.map(name).join('\n'));
          setCopyStatus('Copied!');
        } catch {
          setCopyStatus('Copy failed — try again');
        }
      }}><CodeXml size={14} /><span aria-live="polite">{copyStatus || 'Copy item names'}</span></button>}
      <button type="button" disabled={!items.length} onClick={() => { menu.current?.hidePopover(); onClear(); }}><X size={14} />Clear all</button>
      {!items.length && <span>No items banned</span>}
      {[...groups].sort((a, b) => Number(b[1].length > 1 || oreNames.has(b[0])) - Number(a[1].length > 1 || oreNames.has(a[0]))).map(([key, members]) => {
        const sorted = members.toSorted((a, b) => Number(b.kind === 'fluid') - Number(a.kind === 'fluid') || name(a).localeCompare(name(b)));
        const fluid = sorted.find(item => item.kind === 'fluid') ?? (families[sorted[0].id] ?? []).map(id => familyItems[id]).find(item => item?.kind === 'fluid');
        const groupName = oreNames.get(key) ?? name(sorted[0]);
        const pending = members.some(item => !appliedItemIds.includes(item.id));
        const rows = sorted.map(item => <div key={item.id} className="planner-needed-ban-row" onContextMenu={event => openVariantMenu(event, item.id)} data-pending={!appliedItemIds.includes(item.id) || undefined} title={!appliedItemIds.includes(item.id) ? 'Pending: click Find suggestions to apply' : undefined}>
          <ItemSlot item={item} tooltipAtPointer /><span>{name(item)}</span>
          <button type="button" aria-label={`Allow ${name(item)} to be needed`} onClick={() => onRemove(item.id)}><X size={14} /></button>
        </div>);
        if (members.length === 1 && !oreNames.has(key)) return rows[0];
        return <details key={key} className="planner-needed-ban-group">
      <summary className="planner-needed-ban-heading" onContextMenu={event => openVariantMenu(event, sorted[0].id)} data-pending={pending || undefined} title={pending ? 'Pending: click Find suggestions to apply' : undefined}>
        <ChevronDown size={14} />{fluid && <span className="planner-needed-ban-fluid"><ItemSlot item={fluid} tooltipAtPointer /></span>}<span className="planner-needed-ban-name">{groupName}</span><span className="planner-needed-ban-count">({members.length})</span>
        <button type="button" aria-label={`Allow all ${groupName} items to be needed`} title="Remove group" onClick={event => { event.preventDefault(); event.stopPropagation(); onRemoveGroup(members.map(item => item.id)); }}><X size={14} /></button>
      </summary>
      {rows}
      </details>;
      })}
      <div ref={variantMenu} popover="auto" role="menu" className="diagram-selection-menu planner-needed-menu">
        {variantItemId && missingVariants(variantItemId).length > 0 && <button type="button" role="menuitem" onClick={() => {
          variantMenu.current?.hidePopover();
          onAddVariants(missingVariants(variantItemId));
        }}><Ban size={14} />Not allowed to be needed for all variants</button>}
      </div>
    </div>
  </div>;
}
