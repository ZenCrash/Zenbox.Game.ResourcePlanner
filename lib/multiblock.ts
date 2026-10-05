import type { Item, Recipe } from './model';
import { selectedMachine, machineVoltage, machineTiers } from './machine-selection';
import hatchCapabilities from './multiblock-hatch-capabilities.json';

export type MultiblockConfig = { coilId?: string; energyHatchId?: string; energyHatches?: number };
// GT++ stores these modifiers as Java floats, then passes them as doubles.
const bulk = (speed: number, euUsage: number, parallelsPerTier: number) => ({
  kind: 'bulk' as const, coils: 0, speed,
  timeMultiplier: Math.fround(1 / Math.fround(speed)),
  discount: Math.fround(euUsage), parallelsPerTier,
});
// Rules verified against the installed GT5-Unofficial 5.09.51.482 classes.
// Do not infer compatibility/bonuses from a controller name containing "multi".
const profiles = {
  'Electric Blast Furnace': { kind: 'blast', coils: 16 },
  'Volcanus': { ...bulk(2.2, .9, 0), kind: 'volcanus', coils: 16 },
  'Pyrolyse Oven': { kind: 'pyrolyse', coils: 9 },
  'Oil Cracking Unit': { kind: 'cracking', coils: 16 },
  'Large Chemical Reactor': { kind: 'perfect', coils: 0 },
  'Vacuum Freezer': { kind: 'standard', coils: 0 },
  'Distillation Tower': { kind: 'standard', coils: 0 },
  'Molecular Transformer': { kind: 'standard', coils: 0 },
  'Nuclear Salt Processing Plant': bulk(2.5, 1, 2),
  'Industrial Mixing Machine': bulk(3.5, 1, 8),
  'Industrial Centrifuge': bulk(2.25, .9, 6),
  'Industrial Wire Factory': bulk(3, .75, 4),
  'Large Thermal Refinery': bulk(2.5, .8, 8),
  'Large Sifter Control Block': bulk(5, .75, 4),
  'Industrial Extrusion Machine': bulk(3.5, 1, 4),
  'Industrial Material Press': bulk(6, 1, 4),
  'Industrial Cutting Factory': bulk(3, .75, 4),
  'Thermic Heating Device': bulk(2.2, .9, 8),
  'Industrial Electrolyzer': bulk(2.8, .9, 2),
  'Amazon Warehousing Depot': bulk(6, .75, 16),
  'TurboCan Pro': bulk(2, 1, 8),
  'Big Barrel Brewery': bulk(1.5, 1, 4),
} as const;
export function multiblockProfile(recipe: Recipe, machineId?: string) {
  const machine = selectedMachine(recipe, machineId);
  const name = machine?.name.replace(/§./g, '');
  return (name ? profiles[name as keyof typeof profiles] : undefined)
    ?? (machine && machine.id in hatchCapabilities ? { kind: 'hatch-only' as const, coils: 0 } : undefined);
}
export function multiblockHatchLimits(recipe: Recipe, machineId?: string) {
  const id = selectedMachine(recipe, machineId)?.id;
  const limits = id ? hatchCapabilities[id as keyof typeof hatchCapabilities] : undefined;
  return { min: Math.max(1, limits?.min ?? 1), max: limits?.max ?? 2,
    minTier: limits && 'minTier' in limits ? String(limits.minTier) : 'ULV',
    verifiedAmountLimit: limits?.verifiedAmountLimit ?? false, notes: limits?.notes };
}
export const multiblockPartIds = [
  'fluid:pyrotheum',
  ...Array.from({ length: 14 }, (_, i) => `gregtech:gt.blockcasings5${i ? ':' + i : ''}`),
  ...Array.from({ length: 10 }, (_, i) => `gregtech:gt.blockmachines:${40 + i}`),
  ...Array.from({ length: 5 }, (_, i) => `gregtech:gt.blockmachines:${11300 + i}`),
];
const coilHeatCache = new WeakMap<Item, { tooltip: string; heat: number }>();
export function coilHeat(item: Item) {
  const cached = coilHeatCache.get(item);
  if (cached?.tooltip === item.tooltip) return cached.heat;
  const heat = Number(item.tooltip.replace(/§./g, '').match(/Base Heating Capacity\s*=\s*(\d+)/)?.[1] ?? 0);
  coilHeatCache.set(item, { tooltip: item.tooltip, heat });
  return heat;
}
export function requiredHeat(recipe: Recipe) {
  let lines: string[] = [];
  try { lines = JSON.parse(recipe.details); } catch {}
  return Number(lines.find(x => /^(Heat Capacity|Required Heat|Special value):/i.test(x.replace(/§./g, '')))?.replace(/§./g, '').match(/:\s*([\d,]+)/)?.[1].replaceAll(',', '') ?? 0);
}
export function multiblockOptions(recipe: Recipe, machineId?: string) {
  const parts = recipe.multiblockParts ?? [];
  const limits = multiblockHatchLimits(recipe, machineId);
  const minimumVoltage = 8 * 4 ** Math.max(0, machineTiers.indexOf(limits.minTier));
  return {
    coils: parts.filter(x => coilHeat(x) > 0).sort((a, b) => coilHeat(a) - coilHeat(b)),
    hatches: parts.filter(x => /^(\w+) Energy Hatch$/.test(x.name) && (machineVoltage(x) ?? 0) >= minimumVoltage).sort((a, b) => (machineVoltage(a) ?? 0) - (machineVoltage(b) ?? 0)),
  };
}
export function multiblockSetup(recipe: Recipe, machineId?: string, config: MultiblockConfig = {}) {
  const profile = multiblockProfile(recipe, machineId);
  if (!profile || (profile.kind !== 'hatch-only' && (recipe.euPerTick <= 0 || recipe.durationTicks <= 0))) return;
  const { coils, hatches } = multiblockOptions(recipe, machineId);
  const limits = multiblockHatchLimits(recipe, machineId);
  const count = Math.max(limits.min, Math.min(limits.max, Math.floor(config.energyHatches ?? limits.min)));
  // A single normal 2A hatch is limited to 1A by ProcessingLogic. Two supply 4A.
  const amps = count === 1 ? 1 : count * 2;
  const hatch = hatches.find(x => x.id === config.energyHatchId) ?? hatches.find(x => (machineVoltage(x) ?? 0) * amps >= recipe.euPerTick && (profile.kind !== 'bulk' || (machineVoltage(x) ?? 0) * count > 8)) ?? hatches.at(-1);
  if (!hatch) return;
  const voltage = machineVoltage(hatch)!;
  const heatProcessing = profile.kind === 'blast' || profile.kind === 'volcanus';
  const parallelProcessing = profile.kind === 'bulk' || profile.kind === 'volcanus';
  const heatBonus = 100 * (Math.ceil(Math.log(voltage * count / 8) / Math.log(4)) - 2);
  const coil = profile.coils ? coils.find(x => x.id === config.coilId) ?? coils.find(x => !heatProcessing || coilHeat(x) + (profile.kind === 'blast' ? heatBonus : 0) >= requiredHeat(recipe)) ?? coils.at(-1) : undefined;
  if (profile.coils && !coil) return;
  const heat = coil ? coilHeat(coil) + (profile.kind === 'blast' ? heatBonus : 0) : 0;
  const coilTier = coil ? Math.round((coilHeat(coil) - 1801) / 900) : 0;
  const excessHeat = Math.max(0, heat - requiredHeat(recipe));
  const discount = heatProcessing ? .95 ** Math.floor(excessHeat / 900) * (profile.kind === 'volcanus' ? profile.discount : 1)
    : profile.kind === 'cracking' ? 1 - Math.min(.5, .1 * (coilTier + 1)) : profile.kind === 'bulk' ? profile.discount : 1;
  const timeMultiplier = profile.kind === 'pyrolyse' ? 2 / (coilTier + 1) : parallelProcessing ? profile.timeMultiplier : 1;
  const available = voltage * amps;
  const discounted = recipe.euPerTick * discount;
  const error = heatProcessing && heat < requiredHeat(recipe) ? `Requires ${requiredHeat(recipe).toLocaleString()} K; these coils provide ${Math.max(0, heat - 1).toLocaleString()} K.`
    : profile.kind === 'bulk' && voltage * count <= 8 ? 'Requires at least LV combined hatch voltage for parallel processing.'
    : (parallelProcessing ? Math.ceil(discounted) : recipe.euPerTick) > available ? `Requires ${Math.ceil(parallelProcessing ? discounted : recipe.euPerTick).toLocaleString()} EU/t; these hatches provide ${available.toLocaleString()} EU/t.` : undefined;
  // getMaxInputVoltageMulti sums matching hatch voltages. ParallelHelper first
  // fills the power-limited batch, then spends remaining power on overclocks.
  const parallelLimit = profile.kind === 'volcanus' ? 8 : profile.kind === 'bulk' ? profile.parallelsPerTier * Math.ceil(Math.log(voltage * count / 8) / Math.log(4)) : 1;
  const powerOverclocks = (eu: number) => Math.max(0, Math.floor(Math.log(Math.max(1, Math.floor(available / Math.max(32, Math.trunc(eu))))) / Math.log(4)));
  const limitOverclocks = powerOverclocks(discounted * parallelLimit);
  // ParallelHelper converts overclocks below one tick into extra parallels.
  const limitPerfect = heatProcessing ? Math.min(limitOverclocks, Math.floor(excessHeat / 1800)) : 0;
  const parallelMultiplier = parallelProcessing
    ? Math.max(1, 4 ** limitPerfect * 2 ** (limitOverclocks - limitPerfect) / (recipe.durationTicks * timeMultiplier)) : 1;
  const parallel = parallelProcessing
    ? Math.max(0, Math.min(Math.floor(parallelLimit * parallelMultiplier), Math.floor(available / Math.ceil(discounted)))) : 1;
  const overclocks = powerOverclocks(discounted * Math.min(parallelLimit, parallel));
  const perfect = profile.kind === 'perfect' ? overclocks : heatProcessing ? Math.min(overclocks, Math.floor(excessHeat / 1800)) : 0;
  const euPerTick = Math.ceil(discounted * Math.min(parallelLimit, parallel) * 4 ** overclocks);
  const durationTicks = Math.max(1, Math.floor(recipe.durationTicks * timeMultiplier / (4 ** perfect * 2 ** (overclocks - perfect))));
  const tier = machineTiers[Math.min(14, Math.ceil(Math.log(voltage / 8) / Math.log(4)))];
  return { profile, coil, hatch, count, amps, voltage, available, heat, discount, timeMultiplier, overclocks, perfect, parallel, parallelLimit, euPerTick, durationTicks, tier, error };
}
export function configuredMultiblockRecipe(recipe: Recipe, machineId?: string, config?: MultiblockConfig): Recipe | undefined {
  const setup = multiblockSetup(recipe, machineId, config);
  if (!setup || setup.profile.kind === 'hatch-only') return;
  let details: string[] = [];
  try { details = JSON.parse(recipe.details); } catch {}
  const pyrotheum = setup.profile.kind === 'volcanus' ? recipe.multiblockParts?.find(item => item.id === 'fluid:pyrotheum') : undefined;
  const ingredients = pyrotheum ? [...recipe.ingredients, {
    itemId: pyrotheum.id, item: pyrotheum, direction: 'input', consumed: true,
    amount: setup.durationTicks / 2 / Math.max(1, setup.parallel), chance: 1,
    slot: Math.max(-1, ...recipe.ingredients.filter(i => i.direction === 'input').map(i => i.slot)) + 1,
    x: null, y: null, alternatives: '[]',
  }] : recipe.ingredients;
  return { ...recipe, euPerTick: setup.error ? 0 : setup.euPerTick, durationTicks: setup.error ? 0 : setup.durationTicks,
    ingredients,
    parallel: setup.error ? 0 : setup.parallel,
    details: JSON.stringify([...details.filter(x => !/^(Voltage|Usage|Amperage):/i.test(x)),
      `Voltage: ${setup.voltage.toLocaleString('en-US')} EU/t (${setup.tier})`,
      `Amperage: ${setup.euPerTick / setup.voltage} A`,
      ...(setup.error ? [setup.error] : []),
    ]) };
}
