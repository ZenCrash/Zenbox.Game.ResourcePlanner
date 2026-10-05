"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronDown, Zap } from "lucide-react";
import type { AreaSummary } from "@/lib/area-summary";
import {
  convertSummaryRate,
  FUEL_EU_OUTPUT_ID, NET_FUEL_EU_OUTPUT_ID, NORMALIZED_NET_FUEL_EU_OUTPUT_ID, isFuelEnergy, fuelEnergy,
  formatTotalEu,
  TOTAL_EU_INPUT_ID,
  type SummaryCalculation,
} from "@/lib/summary-rate";

import { useFuelValues } from "./use-fuel-values";

type Flow = AreaSummary["inputs"][number];
const name = (flow: Flow) => flow.item.name.replace(/§[0-9a-fk-or]/gi, "");
const fuelDescription = (id: string) => id === FUEL_EU_OUTPUT_ID
  ? "The energy value of a produced fuel."
  : id === NET_FUEL_EU_OUTPUT_ID
    ? "The energy value of a produced fuel minus its production cost."
    : id === NORMALIZED_NET_FUEL_EU_OUTPUT_ID
      ? "Produced fuel energy minus the group's production cost, per 1,000 L of fluid or one fuel cell/container."
      : "";
const format = (value: number | null) =>
  value === null ? "" : String(Number(value.toPrecision(12)));

function ResourcePicker({
  label,
  items,
  selected,
  onSelect,
}: {
  label: string;
  items: Flow[];
  selected: Flow;
  onSelect: (id: string) => void;
}) {
  const flyout = useRef<HTMLDivElement>(null);
  return (
    <div className="summary-resource-picker">
      <button
        type="button"
        className="summary-resource-trigger"
        title={fuelDescription(selected.item.id) ? `${name(selected)}\n${fuelDescription(selected.item.id)}` : undefined}
        aria-haspopup="menu"
        aria-label={`${label} resource: ${name(selected)}`}
        onClick={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const menu = flyout.current;
          if (!menu) return;
          menu.style.left = `${Math.max(8, Math.min(bounds.left, window.innerWidth - 260))}px`;
          menu.style.top = `${Math.max(8, Math.min(bounds.bottom + 4, window.innerHeight - 240))}px`;
          menu.showPopover();
        }}
      >
        {selected.item.kind === "energy"
          ? <Zap size={24} style={{ flexShrink: 0 }} aria-hidden="true" />
          : selected.item.image && <img src={selected.item.image} alt="" className={selected.item.kind === "fluid" ? "summary-fluid-image" : undefined} />}
        <span>{name(selected)}</span>
        <ChevronDown size={14} />
      </button>
      <div
        ref={flyout}
        popover="auto"
        role="menu"
        aria-label={`${label} resources`}
        className="summary-resource-options nodrag nopan nowheel"
      >
        {items.map((flow) => (
          <button
            key={flow.item.id}
            type="button"
            role="menuitemradio"
            title={fuelDescription(flow.item.id) ? `${name(flow)}\n${fuelDescription(flow.item.id)}` : undefined}
            aria-checked={flow.item.id === selected.item.id}
            onClick={() => {
              onSelect(flow.item.id);
              flyout.current?.hidePopover();
            }}
          >
            {flow.item.kind === "energy"
              ? <Zap size={24} style={{ flexShrink: 0 }} aria-hidden="true" />
              : flow.item.image && <img src={flow.item.image} alt="" className={flow.item.kind === "fluid" ? "summary-fluid-image" : undefined} />}
            <span>{name(flow)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function SummaryRateCalculator({
  summary,
  calculation: edit,
  onChange,
  readOnly = false,
}: {
  summary: AreaSummary;
  calculation: SummaryCalculation;
  onChange: (value: SummaryCalculation) => void;
  readOnly?: boolean;
}) {
  const { inputId, outputId } = edit;
  const calculator = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (readOnly) return;
    const deselect = (event: PointerEvent) => {
      const root = calculator.current;
      if (!root || !(event.target instanceof Node)) return;
      const target = event.target;
      // Capture runs before the diagram can prevent the browser's usual blur.
      const active = document.activeElement;
      if (active instanceof HTMLElement && root.contains(active) && !active.contains(target)) active.blur();
      for (const picker of root.querySelectorAll(".summary-resource-picker")) {
        if (picker.contains(target)) continue;
        const menu = picker.querySelector<HTMLElement>("[popover]");
        if (menu?.matches(":popover-open")) menu.hidePopover();
        const restored = document.activeElement;
        if (restored instanceof HTMLElement && picker.contains(restored)) restored.blur();
      }
    };
    document.addEventListener("pointerdown", deselect, true);
    return () => document.removeEventListener("pointerdown", deselect, true);
  }, [readOnly]);
  const [focusedField, setFocusedField] = useState<"input" | "output" | null>(null);
  const energyInput: Flow = {
    rate: summary.totalEu,
    item: { id: TOTAL_EU_INPUT_ID, name: "Total EU", kind: "energy", image: null,
      registryId: "", metadata: 0, mod: "", group: "", tooltip: "[]" },
  };
  const fuelValues = useFuelValues(summary.outputs.map(flow => flow.item.id));
  const fuelInputs = summary.outputs.filter(flow => fuelValues[flow.item.id]);
  const isFuel = isFuelEnergy(outputId);
  const inputs = isFuel ? fuelInputs : [energyInput, ...summary.inputs];
  const isNormalizedNetFuel = outputId === NORMALIZED_NET_FUEL_EU_OUTPUT_ID;
  const isNetFuel = outputId === NET_FUEL_EU_OUTPUT_ID || isNormalizedNetFuel;
  const fuel = fuelValues[inputId];
  const fuelFlow = summary.outputs.find(flow => flow.item.id === inputId);
  const energyOutputs: Flow[] = fuelInputs.length ? [
    { ...energyInput, item: { ...energyInput.item, id: FUEL_EU_OUTPUT_ID, name: "Fuel value" } },
    { ...energyInput, item: { ...energyInput.item, id: NET_FUEL_EU_OUTPUT_ID, name: "Net fuel value" } },
    { ...energyInput, item: { ...energyInput.item, id: NORMALIZED_NET_FUEL_EU_OUTPUT_ID, name: "Net EU / unit" } },
  ] : [];
  const outputs = isFuel ? energyOutputs : summary.outputs;
  const isEnergy = inputId === TOTAL_EU_INPUT_ID;
  const setInputId = (id: string) => {
    const selectedFuel = fuelInputs.find(flow => flow.item.id === id);
    if (!selectedFuel && !isFuel && id !== TOTAL_EU_INPUT_ID && !isEnergy) {
      onChange({ ...edit, inputId: id });
      return;
    }
    onChange({ ...edit, inputId: id, side: "input",
      outputId: selectedFuel ? (isFuel ? outputId : FUEL_EU_OUTPUT_ID) : isFuel ? summary.outputs[0].item.id : outputId,
      value: String(inputs.find(flow => flow.item.id === id)?.rate ?? 0) });
  };
  const setOutputId = (id: string) => {
    if (isFuelEnergy(id)) {
      const selectedFuel = fuelInputs.find(flow => flow.item.id === inputId)
        ?? fuelInputs.find(flow => flow.item.id === outputId)
        ?? fuelInputs[0];
      if (!selectedFuel) return;
      onChange({ ...edit, outputId: id, inputId: selectedFuel.item.id, side: "input",
        value: selectedFuel.item.id === inputId && edit.side === "input" ? edit.value : String(selectedFuel.rate) });
    } else onChange({ ...edit, outputId: id });
  };
  const input = inputs.find((flow) => flow.item.id === inputId);
  const output = outputs.find((flow) => flow.item.id === outputId);
  if (!input || !output) return null;
  const numeric = isNormalizedNetFuel ? (fuelFlow?.item.kind === "fluid" ? 1000 : 1) : isNetFuel ? fuelFlow?.rate ?? null : edit?.value.trim() ? Number(edit.value) : null;
  const inputValue = isNetFuel ? format(numeric) : isEnergy && edit.side === "input" ? format(summary.totalEu) : !edit
    ? format(input.rate)
    : edit.side === "input"
      ? edit.value
      : numeric === null
        ? ""
        : format(convertSummaryRate(numeric, output.rate, input.rate));
  const outputValue = isFuel ? format(numeric === null || !fuel || !fuelFlow ? null : fuelEnergy(numeric, fuel.euPerUnit, fuelFlow.rate, summary.euPerTick, isNetFuel)) : isEnergy && edit.side === "input" ? format(output.rate) : !edit
    ? format(output.rate)
    : edit.side === "output"
      ? edit.value
      : numeric === null
        ? ""
        : format(convertSummaryRate(numeric, input.rate, output.rate));
  if (readOnly) {
    const resource = (flow: Flow, value: string) => {
      const amount = value === "" ? "—" : flow.item.kind === "energy"
        ? formatTotalEu(Number(value))
        : Number(value).toLocaleString("de-DE", { maximumFractionDigits: 4 });
      const unit = flow.item.kind === "energy" ? "EU" : flow.item.kind === "fluid" ? (isFuel ? "L" : "mB/s") : (isFuel ? "items" : "items/s");
      const fullAmount = value === "" ? "—" : Number(value).toLocaleString(flow.item.kind === "energy" ? "de-DE" : undefined, { maximumSignificantDigits: 21 });
      return <span className="summary-rate-text-resource" title={name(flow) + ": " + fullAmount + " " + unit + (fuelDescription(flow.item.id) ? "\n" + fuelDescription(flow.item.id) : "")}>
        <span className="summary-rate-resource-label">
          {flow.item.kind === "energy" ? <Zap size={14} aria-hidden="true" /> : flow.item.image && <img src={flow.item.image} alt="" className={flow.item.kind === "fluid" ? "summary-fluid-image" : undefined} />}
          <span>{name(flow)}</span>
        </span>
        <span className="summary-rate-resource-amount" data-calculated={isNetFuel || flow.item.kind === 'energy' || undefined}>{amount}{" "}<span className="summary-rate-resource-unit">{unit}</span></span>
      </span>;
    };
    return <div className="summary-rate-text" data-fuel={isFuel || undefined} aria-label="Resource rate calculator">
      {resource(input, inputValue)}
      <ArrowRight size={12} aria-hidden="true" />
      {resource(output, outputValue)}
    </div>;
  }
  return (
    <div
      ref={calculator}
      className="summary-rate-calculator nodrag nopan"
      data-fuel={isFuel || undefined}
      aria-label="Resource rate calculator"
      title={isFuel ? `Best fuel value: ${fuel?.handler ?? ""}. Net value subtracts the whole group’s operating EU for the time required to produce this amount. Generator losses are not included.` : isEnergy ? "Total EU is calculated automatically from the grouping. Changing the produced rate scales the displayed energy proportionally." : "Scales the grouping's net input/output ratio. Partially supplied resources use the remaining shortage."}
    >
      {(
        [
          ["input", isFuel ? "Fuel amount" : "Needed", input, inputs, inputValue, setInputId],
          [
            "output",
            "Produced",
            output,
            outputs,
            outputValue,
            setOutputId,
          ],
        ] as const
      ).map(([side, label, selected, items, value, select]) => (
        <Fragment key={side}>
          {side === "output" && <ArrowRight className="summary-rate-arrow" size={20} aria-hidden="true" />}
        <div className="summary-rate-side">
          <label className="summary-rate-field" title={selected.item.kind === "energy" && value !== "" ? `${name(selected)}: ${Number(value).toLocaleString("de-DE", { maximumSignificantDigits: 21 })} EU${fuelDescription(selected.item.id) ? "\n" + fuelDescription(selected.item.id) : ""}` : undefined}>
            <input
              type={selected.item.kind !== "energy" && focusedField === side ? "number" : "text"}
              inputMode="decimal"
              onFocus={() => setFocusedField(side)}
              onBlur={() => setFocusedField(null)}
              min="0"
              step="any"
              aria-label={side === "input" && isEnergy ? "Total EU" : `${label} resource rate`}
              disabled={isNetFuel || (side === "input" && isEnergy) || (side === "output" && isFuel)}
              value={selected.item.kind === "energy" && value !== ""
                ? formatTotalEu(Number(value))
                : focusedField !== side && value !== "" && Number.isFinite(Number(value))
                  ? Number(value).toLocaleString("de-DE", { maximumSignificantDigits: 12 })
                  : value}
              onChange={(event) =>
                onChange({ ...edit, side, value: event.target.value })
              }
            />
            <span>{selected.item.kind === "energy" ? "EU" : selected.item.kind === "fluid" ? (isFuel ? "L" : "mB/s") : (isFuel ? "items" : "items/s")}</span>
          </label>
          <ResourcePicker
            label={label}
            items={items}
            selected={selected}
            onSelect={select}
          />
        </div>
        </Fragment>
      ))}
    </div>
  );
}
