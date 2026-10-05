export const TOTAL_EU_INPUT_ID = "__grouping_total_eu__";

export function convertSummaryRate(
  value: number,
  fromRate: number,
  toRate: number,
) {
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    !Number.isFinite(fromRate) ||
    fromRate <= 0 ||
    !Number.isFinite(toRate) ||
    toRate < 0
  )
    return null;
  const result = (value / fromRate) * toRate;
  return Number.isFinite(result) ? result : null;
}
import type { DiagramDocument } from "./model";
export type SummaryCalculation = NonNullable<
  NonNullable<DiagramDocument["areas"]>[number]["calculators"]
>[number];

const compactEnergy = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });
export function formatTotalEu(value: number) {
  return Math.abs(value) >= 10000
    ? compactEnergy.format(value).replace("K", "k")
    : value.toLocaleString("de-DE", { maximumFractionDigits: 4 });
}

export function moveSummaryCalculation(values: SummaryCalculation[], sourceId: string, targetId: string, position: "before" | "after") {
  if (sourceId === targetId) return values;
  const source = values.find(value => value.id === sourceId);
  if (!source || !values.some(value => value.id === targetId)) return values;
  const next = values.filter(value => value.id !== sourceId);
  const index = next.findIndex(value => value.id === targetId) + (position === "after" ? 1 : 0);
  next.splice(index, 0, source);
  return next.every((value, i) => value === values[i]) ? values : next;
}


export const FUEL_EU_OUTPUT_ID = "__fuel_eu__";
export const NET_FUEL_EU_OUTPUT_ID = "__net_fuel_eu__";
export const NORMALIZED_NET_FUEL_EU_OUTPUT_ID = "__normalized_net_fuel_eu__";
export const isFuelEnergy = (id: string) => id === FUEL_EU_OUTPUT_ID || id === NET_FUEL_EU_OUTPUT_ID || id === NORMALIZED_NET_FUEL_EU_OUTPUT_ID;
/** Compare fluid fuels per bucket and packaged fuels per item. */
export function normalizedNetFuelValue(netEu: number, amount: number, fluid: boolean) {
  if (!Number.isFinite(netEu) || !Number.isFinite(amount) || amount <= 0) return -Infinity;
  return netEu / (amount / (fluid ? 1000 : 1));
}
export function fuelEnergy(amount: number, euPerUnit: number, productionRate: number, euPerTick: number, net: boolean) {
  if (![amount, euPerUnit, productionRate, euPerTick].every(Number.isFinite) || amount < 0 || euPerUnit <= 0 || productionRate <= 0) return null;
  return amount * (euPerUnit - (net ? euPerTick * 20 / productionRate : 0));
}
export function summaryCalculationAvailable(summary: import("./area-summary").AreaSummary, calculation: SummaryCalculation) {
  if (isFuelEnergy(calculation.outputId)) return summary.outputs.some(flow => flow.item.id === calculation.inputId);
  return (calculation.inputId === TOTAL_EU_INPUT_ID || summary.inputs.some(flow => flow.item.id === calculation.inputId)) && summary.outputs.some(flow => flow.item.id === calculation.outputId);
}
