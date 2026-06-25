import assert from 'node:assert/strict';
import fs from 'fs';
import { applyFilters, buildDailyTable, totals } from './src/lib/aggregate.js';

// Read the JSON cache file
const rawData = fs.readFileSync('./public/dashboard-cache.json', 'utf8');
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
assert.ok(filtered3.length > 0, 'Expected year filter to take priority over the manual date range');
assert.ok(dailyRows3.length > 0, 'Expected daily rows for year 2025');

console.log('Filter checks passed.');
