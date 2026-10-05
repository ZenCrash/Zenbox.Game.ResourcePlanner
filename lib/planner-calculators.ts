import type { Item } from './model';
import { TOTAL_EU_INPUT_ID, NORMALIZED_NET_FUEL_EU_OUTPUT_ID, type SummaryCalculation } from './summary-rate';

export function plannerDefaultCalculators(target: Item, fuel: boolean): SummaryCalculation[] {
  if (fuel) return [
    { id: 'wizard-normalized-net-fuel-value', inputId: target.id, outputId: NORMALIZED_NET_FUEL_EU_OUTPUT_ID, side: 'input', value: target.kind === 'fluid' ? '1000' : '1' },
  ];
  return [
    { id: 'wizard-total-eu', inputId: TOTAL_EU_INPUT_ID, outputId: target.id, side: 'output', value: target.kind === 'fluid' ? '1000' : '1' },
  ];
}
