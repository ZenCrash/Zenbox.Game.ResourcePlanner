"use client";
import { Zap, BatteryCharging } from "lucide-react";
import type { AreaSummary } from "@/lib/area-summary";
import { FUEL_EU_OUTPUT_ID, NET_FUEL_EU_OUTPUT_ID, NORMALIZED_NET_FUEL_EU_OUTPUT_ID, type SummaryCalculation } from "@/lib/summary-rate";
import { useFuelValues } from "./use-fuel-values";
export function AddFuelCalculators({ summary, disabled, onAdd, menu = false }: { menu?: boolean; summary: AreaSummary; disabled: boolean; onAdd: (value: SummaryCalculation) => void }) {
  const fuels = useFuelValues(summary.outputs.map(flow => flow.item.id));
  const first = summary.outputs.find(flow => fuels[flow.item.id]);
  const add = (outputId: string) => {
    if (!first || disabled) return;
    onAdd({ id: crypto.randomUUID(), inputId: first.item.id, outputId, side: "input", value: String(first.rate) });
  };
  return <>
    <button type="button" role={menu ? "menuitem" : undefined} disabled={disabled || !first} onClick={() => add(FUEL_EU_OUTPUT_ID)} title="Add a calculator for the energy value of a produced fuel"><Zap size={16} />{menu ? "Add fuel value" : "Fuel value"}</button>
    <button type="button" role={menu ? "menuitem" : undefined} disabled={disabled || !first} onClick={() => add(NET_FUEL_EU_OUTPUT_ID)} title="Add a calculator for produced fuel energy minus the group's production cost"><BatteryCharging size={16} />{menu ? "Add net fuel value" : "Net fuel value"}</button>
    <button type="button" role={menu ? "menuitem" : undefined} disabled={disabled || !first} onClick={() => add(NORMALIZED_NET_FUEL_EU_OUTPUT_ID)} title="Net fuel energy per 1,000 L of fluid or one fuel cell/container"><BatteryCharging size={16} />{menu ? "Add Net EU / unit" : "Net EU / unit"}</button>
  </>;
}
