import type { Item, Recipe } from "./model";
import { recipePowerInfo } from "./recipe-power";

export const machineTiers = [
  "ULV",
  "LV",
  "MV",
  "HV",
  "EV",
  "IV",
  "LuV",
  "ZPM",
  "UV",
  "UHV",
  "UEV",
  "UIV",
  "UMV",
  "UXV",
  "MAX",
];
export const tierColors: Record<string, string> = {
  ULV: "#555555",
  LV: "#555555",
  MV: "#ffaa00",
  HV: "#ffff55",
  EV: "#555555",
  IV: "#ffffff",
  LuV: "#ff55ff",
  ZPM: "#55ffff",
  UV: "#55ff55",
  UHV: "#aa0000",
  UEV: "#aa00aa",
  UIV: "#5555ff",
  UMV: "#ff5555",
};
const machineMetadataCache = new WeakMap<Item, { name: string; tooltip: string; tier: string | undefined; voltage: number | undefined }>();
function machineMetadata(item: Item) {
  const cached = machineMetadataCache.get(item);
  if (cached && cached.name === item.name && cached.tooltip === item.tooltip) return cached;
  const text = item.tooltip.replace(/§./g, "");
  const match =
    text.match(/Voltage IN:[^"\n]*?\((\w+)\)/i)?.[1] ??
    item.name
      .replace(/§./g, "")
      .match(
        /\b(ULV|LV|MV|HV|EV|IV|LuV|ZPM|UV|UHV|UEV|UIV|UMV|UXV|MAX)\b/i,
      )?.[1];
  const tier = machineTiers.find(
    (tier) => tier.toLowerCase() === match?.toLowerCase(),
  );
  const recorded = text.match(/Voltage IN:\s*([\d,]+)/i)?.[1];
  const voltage = recorded ? Number(recorded.replaceAll(',', '')) : tier ? 8 * 4 ** machineTiers.indexOf(tier) : undefined;
  const result = { name: item.name, tooltip: item.tooltip, tier, voltage };
  machineMetadataCache.set(item, result);
  return result;
}
export function machineTier(item: Item) {
  return machineMetadata(item).tier;
}
export function machineVoltage(item: Item): number | undefined {
  return machineMetadata(item).voltage;
}
export function machineOptions(recipe: Recipe) {
  const required = recipePowerInfo(recipe).voltage?.match(/\((\w+)\)/)?.[1];
  const minimum = machineTiers.findIndex(
    (tier) => tier.toLowerCase() === required?.toLowerCase(),
  );
  const options = (recipe.craftingMachines ?? []).filter((item) => {
    const tier = machineTier(item);
    return !tier || machineTiers.indexOf(tier) >= minimum;
  });
  const tiered = options
    .filter((item) => machineTier(item))
    .sort(
      (a, b) =>
        machineTiers.indexOf(machineTier(a)!) -
        machineTiers.indexOf(machineTier(b)!),
    );
  const defaultMachine =
    recipe.euPerTick > 0 ? (tiered[0] ?? options[0]) : options[0];
  return { options, defaultMachine };
}
export function selectedMachine(recipe: Recipe, machineId?: string) {
  const { options, defaultMachine } = machineOptions(recipe);
  return options.find((item) => item.id === machineId) ?? defaultMachine;
}

export function isMachineUpgrade(recipe: Recipe, machineId?: string) {
  const { options, defaultMachine } = machineOptions(recipe);
  const machine = selectedMachine(recipe, machineId);
  if (!machine || machine.id === defaultMachine?.id) return false;
  const tier = machineTier(machine);
  const electricTiers = options.flatMap((option) => {
    const value = machineTier(option);
    return value ? [machineTiers.indexOf(value)] : [];
  });
  if (tier && electricTiers.length)
    return machineTiers.indexOf(tier) > Math.min(...electricTiers);
  // Fuel/steam defaults do not turn their other non-electric alternatives
  // into voltage upgrades.
  if (defaultMachine && !machineTier(defaultMachine) && electricTiers.length)
    return false;
  return true;
}
