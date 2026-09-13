import { readFileSync } from 'node:fs';
function handlers(path) {
  const src = readFileSync(path, 'utf8');
  const key = 'tauri::generate_handler![';
  const i = src.indexOf(key);
  if (i < 0) throw new Error('no generate_handler in ' + path);
  let p = i + key.length, depth = 1, end = -1;
  for (; p < src.length; p++) { const c = src[p]; if (c === '[') depth++; else if (c === ']') { depth--; if (depth === 0) { end = p; break; } } }
  const out = new Map();
  const startLine = src.slice(0, i).split('\n').length;
  src.slice(i + key.length, end).split('\n').forEach((raw, idx) => {
    const m = raw.replace(/\/\/.*$/, '').match(/(?:^|[,\s])commands::([A-Za-z0-9_]+)::([A-Za-z0-9_]+)/);
    if (m) out.set(m[1] + '::' + m[2], startLine + idx + 1);
  });
  return out;
}
function ledger(path) {
  const src = readFileSync(path, 'utf8');
  const out = new Map();
  const re = /\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,?\s*\)/g;
  let m; while ((m = re.exec(src))) out.set(m[1], m[2]);
  const ceil = +(src.match(/DEBT_CEILING:\s*usize\s*=\s*(\d+)/) || [])[1];
  const total = +(src.match(/REGISTERED_TOTAL:\s*usize\s*=\s*(\d+)/) || [])[1];
  return { out, ceil, total };
}
function classify(name, registered, debt) {
  const isScoped = name.endsWith('_scoped');
  const twin = isScoped ? name.slice(0, -7) : name + '_scoped';
  const gated = (n) => registered.has(n) && !debt.has(n);
  if (!debt.has(name)) return { kind: 'GATED', twin };
  if (!isScoped) {
    if (gated(twin)) return { kind: 'A', twin };
    if (registered.has(twin) && debt.has(twin)) return { kind: 'C', twin };
    return { kind: 'D', twin };
  }
  if (!registered.has(twin) && !debt.has(twin)) return { kind: 'E', twin };
  if (gated(twin)) return { kind: 'B', twin };
  return { kind: 'C', twin };
}
const shells = {
  desktop: ['apps/desktop-client/src/lib.rs', 'apps/desktop-client/src/commands/registration_gate_debt.generated.rs'],
  tablet: ['apps/tablet-client/src/lib.rs', 'apps/tablet-client/src/commands/registration_gate_debt.generated.rs'],
};
const B = {};
for (const [shell, [lp, dp]] of Object.entries(shells)) {
  const reg = handlers(lp);
  const L = ledger(dp); const debt = L.out;
  console.log('##### ' + shell + ' registered=' + reg.size + ' (ledger REGISTERED_TOTAL=' + L.total + ') debtRows=' + debt.size + ' (DEBT_CEILING=' + L.ceil + ') gateAccepted=' + (reg.size - debt.size));
  const stale = [...debt.keys()].filter((n) => !reg.has(n));
  console.log('  stale ledger rows absent from live list: ' + (stale.length ? stale.join(', ') : 'none'));
  const counts = {}; const list = [];
  for (const name of reg.keys()) {
    const c = classify(name, reg, debt);
    counts[c.kind] = (counts[c.kind] || 0) + 1;
    list.push({ shell, name, kind: c.kind, twin: c.twin, state: debt.get(name) || 'gate-accepted', line: reg.get(name) });
  }
  B[shell] = { counts, list };
  console.log('  counts: ' + JSON.stringify(counts));
  for (const k of ['A', 'B', 'C', 'E', 'D']) {
    const rows = list.filter((r) => r.kind === k);
    if (!rows.length) continue;
    console.log('  --- ' + k + ' (' + rows.length + ') ---');
    for (const r of rows) console.log('    ' + r.name + '  [' + r.state + ']  twin=' + r.twin + '  @' + shell + '/lib.rs:' + r.line);
  }
  console.log('');
}
const dset = new Set(B.desktop.list.map((r) => r.name));
const shared = [...new Set(B.tablet.list.map((r) => r.name))].filter((n) => dset.has(n));
const kD = Object.fromEntries(B.desktop.list.map((r) => [r.name, r.kind + '|' + r.state]));
const kT = Object.fromEntries(B.tablet.list.map((r) => [r.name, r.kind + '|' + r.state]));
const div = shared.filter((n) => kD[n] !== kT[n]);
console.log('##### DIVERGENCE shared=' + shared.length + ' differentlyClassified=' + div.length);
for (const n of div) console.log('  ' + n + '  DESKTOP=' + kD[n] + '  TABLET=' + kT[n]);
