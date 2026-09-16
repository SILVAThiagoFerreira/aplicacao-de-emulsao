import assert from 'node:assert/strict';
import fs from 'fs';
import { applyFilters, buildDailyTable, buildPlanDailyTable, buildPlanWaterfallRows, totals } from './src/lib/aggregate.js';

// Read the JSON cache file
const rawData = fs.readFileSync(new URL('./public/dashboard-cache.json', import.meta.url), 'utf8');
const cache = JSON.parse(rawData);
const records = cache.records || [];

console.log('Total records:', records.length);

// Let's test a filter by UMB (e.g. UMB "1072")
const filters1 = {
  poligonoSearch: '',
  poligono: 'Todos',
  umb: '1072',
  operador: 'Todos',
  year: 'Todos',
  month: 'Todos',
  startDate: '',
  endDate: ''
};

const filtered1 = applyFilters(records, filters1);
const dailyRows1 = buildDailyTable(filtered1);
console.log('Filtered by UMB 1072:', filtered1.length);
console.log('Daily Rows count:', dailyRows1.length);
if (dailyRows1.length > 0) {
  console.log('Sample Daily Row:', dailyRows1[0]);
}
assert.ok(filtered1.length > 0, 'Expected records for UMB 1072');
assert.ok(dailyRows1.length > 0, 'Expected daily rows for UMB 1072');

// Let's test a filter by Polígono (e.g. "PP02-060125")
const filters2 = {
  poligonoSearch: '',
  poligono: 'PP02-060125',
  umb: 'Todos',
  operador: 'Todos',
  year: 'Todos',
  month: 'Todos',
  startDate: '',
  endDate: ''
};

const filtered2 = applyFilters(records, filters2);
const dailyRows2 = buildDailyTable(filtered2);
console.log('Filtered by Polígono PP02-060125:', filtered2.length);
console.log('Daily Rows count:', dailyRows2.length);
if (dailyRows2.length > 0) {
  console.log('Sample Daily Row:', dailyRows2[0]);
}
assert.equal(filtered2.length, 2, 'Expected two records for PP02-060125');
assert.equal(dailyRows2.length, 1, 'Expected a single aggregated daily row for PP02-060125');

const planRows = buildPlanDailyTable(records, 'PP02-060125');
const planTotal = totals(planRows);
const planWaterfall = buildPlanWaterfallRows(planRows, 'emulsao');
const holeWaterfall = buildPlanWaterfallRows(planRows, 'furos');
assert.equal(planRows.length, 1, 'Expected one loading day for PP02-060125');
assert.equal(planRows[0].furos, 284, 'Expected holes to aggregate by plan and loading day');
assert.equal(planRows[0].emulsao, 24881, 'Expected emulsion to aggregate by plan and loading day');
assert.equal(planWaterfall.at(-1).isTotal, true, 'Expected the final waterfall bar to be the plan total');
assert.equal(planWaterfall.at(-1).value, planTotal.emulsao, 'Expected waterfall total to match the plan total');
assert.equal(holeWaterfall.at(-1).value, planTotal.furos, 'Expected the holes waterfall total to match the plan total');

const syntheticRows = [
  { data: '2026-01-01', dia: '01/01/2026', emulsao: 15, furos: 3 },
  { data: '2026-01-02', dia: '02/01/2026', emulsao: 20, furos: 4 }
];
const syntheticEmulsionWaterfall = buildPlanWaterfallRows(syntheticRows, 'emulsao');
const syntheticHoleWaterfall = buildPlanWaterfallRows(syntheticRows, 'furos');
assert.equal(syntheticEmulsionWaterfall[1].base, 15, 'Expected the emulsion waterfall to start the second day at the first-day total');
assert.equal(syntheticEmulsionWaterfall.at(-1).value, 35, 'Expected the emulsion waterfall total to be 35 kg');
assert.equal(syntheticHoleWaterfall[1].base, 3, 'Expected the holes waterfall to start the second day at the first-day total');
assert.equal(syntheticHoleWaterfall.at(-1).value, 7, 'Expected the holes waterfall total to be 7 holes');
console.log('Plan report aggregation checks passed.');

const filters3 = {
  poligonoSearch: '',
  poligono: 'Todos',
  umb: 'Todos',
  operador: 'Todos',
  year: '2025',
  month: 'Todos',
  startDate: '2026-06-01',
  endDate: '2026-06-30'
};

const filtered3 = applyFilters(records, filters3);
const dailyRows3 = buildDailyTable(filtered3);
console.log('Filtered by year 2025 with a conflicting June range:', filtered3.length);
console.log('Daily Rows count:', dailyRows3.length);
assert.equal(filtered3.length, 0, 'Expected year and manual date filters to be combined');
assert.equal(dailyRows3.length, 0, 'Expected no daily rows outside the selected date range');

console.log('Filter checks passed.');
