import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readIbtHeader } from './ibt-inspect.mjs';
const dir = process.argv[2], S3 = Date.parse('2026-06-09T00:00:00Z') / 1000;
const before = new Map(), after = new Map(); let errs = [];
for (const f of readdirSync(dir).filter(f => f.endsWith('.ibt'))) {
  try {
    const h = readIbtHeader(join(dir, f), { withYaml: false });
    const m = h.sessionStartDate < S3 ? before : after;
    for (const v of h.vars) m.set(v.name, `${v.unit} | ${v.desc}`);
  } catch (e) { errs.push(`${f}: ${e.message}`); }
}
console.log('vars before S3:', before.size, ' after S3:', after.size);
console.log('\nONLY after 2026 S3:'); for (const [n, d] of after) if (!before.has(n)) console.log(`  ${n.padEnd(34)} ${d}`);
console.log('\nONLY before 2026 S3:'); for (const [n, d] of before) if (!after.has(n)) console.log(`  ${n.padEnd(34)} ${d}`);
console.log('\nfuel/incident-ish vars (any time):'); for (const [n, d] of new Map([...before, ...after])) if (/fuel|incid|widget|map|drs|tire|tyre/i.test(n)) console.log(`  ${n.padEnd(34)} ${d}`);
console.log('\nerrors:', errs);
