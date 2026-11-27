// Export saved API responses with the same formatters as the browser, without rerunning paid research.
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {columns, csvReports, datasetRow, markdownReport} from '../src/datasetReport.js';

const [recordsPath, reportDir, exportDir] = process.argv.slice(2);
if (!exportDir) throw new Error('Supply the calibration JSONL, saved report directory, and a new export directory.');
const records = (await readFile(recordsPath, 'utf8')).trim().split(/\r?\n/).map(line => JSON.parse(line))
  .sort((a,b) => Number(a.row) - Number(b.row));
await mkdir(exportDir, {recursive:true});
const rows = [];
for (const record of records) {
  if (!/^\d+$/.test(record.row)) throw new Error('Invalid dataset row ID.');
  if (!record.actual && record.error) {
    rows.push({...Object.fromEntries(columns.map(k => [k,''])), product:record.url, overall:'Investigation incomplete', reasoning:record.error});
    continue;
  }
  const report = JSON.parse(await readFile(join(reportDir, record.row + '.json'), 'utf8'));
  if (report.verdict !== record.actual || !report.dossier || !Array.isArray(report.checks)) {
    throw new Error('Missing or inconsistent report for row ' + record.row);
  }
  const row = datasetRow(report);
  rows.push(row);
  await writeFile(join(exportDir, 'row-' + record.row + '.md'), markdownReport(row, report), {flag:'wx'});
}
await writeFile(join(exportDir, 'products.csv'), '\uFEFF' + csvReports(rows), {flag:'wx'});
const supported = records.filter(r => r.actual && !r.evidenceGap);
const summary = {
  submitted:records.length, completed:records.filter(r => r.actual).length,
  matches:records.filter(r => r.labelMatch).length, gaps:records.filter(r => r.evidenceGap).length,
  substantive:supported.length, substantiveMatches:supported.filter(r => r.labelMatch).length,
  withObservations:records.filter(r => r.observations > 0).length,
  observations:records.reduce((n,r) => n + (r.observations || 0), 0),
  matrix:Object.fromEntries(['green','yellow','red'].map(expected => [expected,
    Object.fromEntries(['green','yellow','red','evidence_gap','failed'].map(actual => [actual,
      records.filter(r => r.expected.toLowerCase() === expected && (r.evidenceGap ? 'evidence_gap' : r.actual || 'failed') === actual).length]))])),
};
await writeFile(join(exportDir, 'metrics.json'), JSON.stringify(summary, null, 2) + '\n', {flag:'wx'});
console.log(JSON.stringify(summary));
