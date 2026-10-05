import { test } from "node:test";
import assert from "node:assert/strict";
import {
  machineOptions,
  machineTier,
  machineVoltage,
  selectedMachine,
} from "../lib/machine-selection";
import { nodeSchema, type Item, type Recipe } from "../lib/model";

const machine = (id: string, tier?: string): Item => ({
  id,
  name: id,
  registryId: id,
  metadata: 0,
  mod: "GT",
  group: "",
  kind: "item",
  image: null,
  tooltip: tier
    ? JSON.stringify([`Voltage IN: §a128 (§6${tier}§r§a)§7`])
    : "[]",
});
const lv = machine("basic", "LV"),
  mv = machine("advanced", "MV"),
  hv = machine("advanced-2", "HV"),
  multi = machine("multiblock");
test('cached machine metadata refreshes when tooltip or name changes', () => {
  const value = machine('LV Machine');
  assert.equal(machineTier(value), 'LV');
  assert.equal(machineVoltage(value), 32);
  value.name = 'HV Machine';
  assert.equal(machineTier(value), 'HV');
  assert.equal(machineVoltage(value), 512);
  value.tooltip = JSON.stringify(['Voltage IN: §a2,048 (§6EV§r)']);
  assert.equal(machineTier(value), 'EV');
  assert.equal(machineVoltage(value), 2048);
});
const recipe: Recipe = {
  id: "assembler",
  name: "Recipe",
  handler: "Assembler",
  durationTicks: 100,
  euPerTick: 120,
  details: "[]",
  layout: "{}",
  ingredients: [],
  craftingMachines: [lv, hv, mv, multi],
};
test("minimum machine is the lowest sufficient voltage tier, not the first catalog machine", () => {
  assert.equal(machineTier(mv), "MV");
  const result = machineOptions(recipe);
  assert.equal(result.defaultMachine?.id, mv.id);
  assert.deepEqual(
    result.options.map((item) => item.id),
    [hv.id, mv.id, multi.id],
  );
  assert.equal(selectedMachine(recipe, hv.id)?.id, hv.id);
  assert.equal(selectedMachine(recipe, lv.id)?.id, mv.id);
});
test("voltage accounts for amperage and non-tiered recipes retain catalog default", () => {
  assert.equal(
    machineOptions({ ...recipe, euPerTick: 480, details: '["Amperage: 4 A"]' })
      .defaultMachine?.id,
    mv.id,
  );
  assert.equal(
    machineOptions({ ...recipe, euPerTick: 0 }).defaultMachine?.id,
    lv.id,
  );
  assert.equal(
    machineOptions({ ...recipe, craftingMachines: [multi] }).defaultMachine?.id,
    multi.id,
  );
  assert.equal(
    machineOptions({ ...recipe, craftingMachines: [] }).defaultMachine,
    undefined,
  );
});
test("machine choice survives diagram validation and older diagrams remain valid", () => {
  const node = {
    id: "33333333-3333-4333-8333-333333333333",
    recipeId: recipe.id,
    position: { x: 0, y: 0 },
    machines: 1,
  };
  assert.equal(
    nodeSchema.parse({ ...node, machineId: hv.id }).machineId,
    hv.id,
  );
  assert.equal(nodeSchema.parse(node).machineId, undefined);
});
