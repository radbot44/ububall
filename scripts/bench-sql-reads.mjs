// Compare original main's query patterns with PR query patterns in local workerd.
// This measures actual SqlStorageCursor.rowsRead, not an estimated scan count.
// Synthetic records only. Setup/backfill reads are excluded from steady-state workloads.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { createTestHarness } from 'wrangler';

const cases = [
  { name: 'collection-200-single', rows: [200, 200], steps: [['collection', 0, 1]] },
  { name: 'collection-1000-single', rows: [1000, 1000], steps: [['collection', 0, 1]] },
  { name: 'collection-5000-single', rows: [5000, 5000], steps: [['collection', 0, 1]] },
  { name: 'collection-10000-single', rows: [10000, 10000], steps: [['collection', 0, 1]] },
  { name: 'collection-5000-reload-20', rows: [5000, 5000], steps: [['collection', 0, 20]] },
  { name: 'collection-10000-reload-40', rows: [10000, 10000], steps: [['collection', 0, 40]] },
  { name: 'mint-500-start-100-packs', rows: [500, 500], steps: [['mints', 0, 100]] },
  { name: 'mint-5000-start-100-packs', rows: [5000, 5000], steps: [['mints', 0, 100]] },
  { name: 'mint-10000-start-250-packs', rows: [10000, 10000], steps: [['mints', 0, 250]] },
  { name: 'offers-5000-300-checks', rows: [5000, 5000], steps: [['offers', 0, 300]] },
  { name: 'inventory-1000-60-choices', rows: [1000, 1000], inventory: 1000, steps: [['inventory', 0, 60]] },
  { name: 'inventory-5000-120-choices', rows: [5000, 5000], inventory: 5000, steps: [['inventory', 0, 120]] },
  { name: 'two-users-heavy-mixed', rows: [5000, 5000], inventory: 3000, steps: [
    ['collection', 0, 15], ['collection', 1, 15],
    ['mints', 0, 120], ['mints', 1, 120],
    ['collection', 0, 20], ['collection', 1, 20],
    ['inventory', 0, 60]
  ] }
];

const harness = createTestHarness({ workers: [{ configPath: './scripts/bench-sql-reads.wrangler.jsonc' }] });
async function send(scenario, payload) {
  const response = await harness.fetch('http://benchmark/run?scenario=' + scenario, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(scenario + ': ' + JSON.stringify(data));
  return data;
}
async function benchmark(scenario, mode) {
  const id = scenario.name + '-' + mode;
  await send(id, { op: 'seed', mode, rows: scenario.rows, inventory: scenario.inventory || 0 });
  const metric = { totalReads: 0, groups: [], signatures: [] };
  let starts = [0, 0];
  for (const [kind, user, count] of scenario.steps) {
    const group = { kind, user, count, reads: 0, pages: 0, returned: 0 };
    let previousHash = null;
    for (let done = 0; done < count;) {
      const chunk = Math.min(kind === 'collection' ? 5 : 25, count - done);
      const data = await send(id, { op: 'run', mode, kind, user, count: chunk, start: starts[user] + done });
      group.reads += data.reads;
      group.pages += data.pages;
      group.returned += data.returned;
      if (kind === 'collection') {
        if (previousHash !== null) assert.equal(data.hash, previousHash, 'Repeated full reloads should return identical collections');
        previousHash = data.hash;
      }
      done += chunk;
    }
    if (kind === 'mints') starts[user] += count;
    if (kind === 'collection') metric.signatures.push({ user, count, hash: previousHash, returned: group.returned });
    metric.totalReads += group.reads;
    metric.groups.push(group);
  }
  return metric;
}
function comma(number) { return number.toLocaleString('en-US'); }
const output = [];
try {
  await harness.listen();
  console.log('Measuring Cloudflare SqlStorageCursor.rowsRead (synthetic, local workerd; seed/setup omitted)');
  for (const scenario of cases) {
    const before = await benchmark(scenario, 'before');
    const after = await benchmark(scenario, 'after');
    assert.deepEqual(after.signatures, before.signatures, 'Collection result order or count changed for ' + scenario.name);
    const delta = before.totalReads - after.totalReads;
    const pct = before.totalReads ? (100 * delta / before.totalReads) : 0;
    const item = { scenario: scenario.name, before: before.totalReads, after: after.totalReads,
      saved: delta, savingsPct: Number(pct.toFixed(2)), groups: before.groups.map((g, i) =>
        ({ kind: g.kind, user: g.user, count: g.count, before: g.reads, after: after.groups[i].reads })),
      recordsPerAccount: scenario.rows };
    output.push(item);
    console.log('SQL_BENCH ' + JSON.stringify(item));
  }
  writeFileSync('sql-rows-read-benchmark.json', JSON.stringify({ source: 'Local Cloudflare workerd rowsRead', scenarios: output }, null, 2) + '\n');
  writeFileSync('sql-rows-read-benchmark.csv', 'scenario,before_rows_read,after_rows_read,rows_saved,percent_saved\n' +
    output.map(o => [o.scenario, o.before, o.after, o.saved, o.savingsPct].join(',')).join('\n') + '\n');
  console.log('\nScenario                                Before        After       Saved    Reduction');
  for (const o of output) {
    console.log(o.scenario.padEnd(38) + comma(o.before).padStart(12) +
      comma(o.after).padStart(13) + comma(o.saved).padStart(13) +
      (o.savingsPct.toFixed(1) + '%').padStart(12));
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const fs = await import('node:fs');
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, '## Durable Object SQL row reads — query workloads\n\n' +
      'Measured locally with workerd SqlStorageCursor.rowsRead; excludes seeding and initial migration. ' +
      'Synthetic workload query shapes mirror the original and PR code; not an end-to-end production request estimate.\n\n' +
      '| Scenario | Before | After | Reduction |\n|---|---:|---:|---:|\n' +
      output.map(o => '| ' + o.scenario + ' | ' + comma(o.before) + ' | ' + comma(o.after) +
        ' | ' + o.savingsPct.toFixed(1) + '% |').join('\n') + '\n');
  }
} finally {
  await harness.close();
}
