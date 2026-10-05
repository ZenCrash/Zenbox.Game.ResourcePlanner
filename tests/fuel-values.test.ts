import { test, after } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../app/api/fuel-values/route";
import { catalog } from "../lib/db";
import { fuelEnergy, summaryCalculationAvailable, FUEL_EU_OUTPUT_ID, NET_FUEL_EU_OUTPUT_ID, NORMALIZED_NET_FUEL_EU_OUTPUT_ID } from "../lib/summary-rate";
import { summarizeArea } from "../lib/area-summary";
after(() => catalog.$disconnect());
test("fuel lookup normalizes cells and liquids and picks the highest generator value", async () => {
  const response = await POST(new Request("http://localhost/api/fuel-values", { method: "POST", body: JSON.stringify(["fluid:creosote", "gregtech:gt.metaitem.01:30712", "fluid:fuel", "gregtech:gt.metaitem.01:30708", "minecraft:stone"]) }));
  assert.equal(response.status, 200);
  const values = await response.json();
  assert.equal(values["fluid:creosote"].euPerUnit, 48);
  assert.equal(values["gregtech:gt.metaitem.01:30712"].euPerUnit, 48000);
  assert.equal(values["gregtech:gt.metaitem.01:30712"].handler, "Semifluid Generator Fuels");
  assert.equal(values["fluid:fuel"].euPerUnit, 480);
  assert.equal(values["gregtech:gt.metaitem.01:30708"].euPerUnit, 480000);
  assert.equal(values["minecraft:stone"], undefined);
});
test("fuel energy subtracts production cost for the selected amount and preserves losses", () => {
  assert.equal(fuelEnergy(1000, 480, 100, 30, false), 480000);
  assert.equal(fuelEnergy(1000, 480, 100, 30, true), 474000);
  assert.equal(fuelEnergy(500, 480, 100, 30, true), 237000);
  assert.equal(fuelEnergy(1000, 1, 100, 30, true), -5000);
  assert.equal(fuelEnergy(1000, 480, 0, 30, true), null);
});
test("normalized net fuel energy agrees for fluid and packaged fuel and scales with the group", () => {
  assert.equal(fuelEnergy(1000, 480, 90000, 96912, true), 458464);
  assert.equal(fuelEnergy(1, 480000, 90, 96912, true), 458464);
  assert.equal(fuelEnergy(1000, 480, 180000, 193824, true), 458464);
});
test("saved fuel calculators survive validation until the produced fuel disappears", () => {
  const summary = summarizeArea({ position: { x: 0, y: 0 }, width: 100, height: 100 }, []);
  summary.outputs.push({ rate: 100, item: { id: "fuel", name: "Fuel", kind: "fluid", image: null, registryId: "", metadata: 0, mod: "", group: "", tooltip: "[]" } });
  for (const outputId of [FUEL_EU_OUTPUT_ID, NET_FUEL_EU_OUTPUT_ID, NORMALIZED_NET_FUEL_EU_OUTPUT_ID]) {
    const calculation = { id: "test", inputId: "fuel", outputId, side: "input" as const, value: "1000" };
    assert(summaryCalculationAvailable(summary, calculation));
    assert(!summaryCalculationAvailable({ ...summary, outputs: [] }, calculation));
  }
});
