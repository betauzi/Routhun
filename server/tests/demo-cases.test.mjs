import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, seedDemo, id, passwordHash } from '../db.mjs';
import { createApp } from '../index.mjs';

function fixture(t) {
  const db = openDatabase(':memory:');
  t.after(() => db.close());
  return db;
}

test('demo seed adds many fictional foundations with varied cases exactly once', t => {
  const db = fixture(t);
  assert.equal(seedDemo(db), true);
  const orgs = db.prepare('SELECT slug,published FROM orgs').all();
  assert.ok(orgs.length >= 20);
  assert.ok(orgs.filter(o => o.published).length >= 18);
  assert.ok(orgs.some(o => o.published === 0));
  const cases = db.prepare('SELECT * FROM demo_scenarios').all();
  assert.ok(cases.length >= 54);
  assert.equal(new Set(cases.map(c => c.org_id)).size >= 18, true);
  const counts = [orgs.length, db.prepare('SELECT COUNT(*) n FROM journals').get().n, cases.length];
  assert.equal(seedDemo(db), false);
  assert.deepEqual([db.prepare('SELECT COUNT(*) n FROM orgs').get().n, db.prepare('SELECT COUNT(*) n FROM journals').get().n, db.prepare('SELECT COUNT(*) n FROM demo_scenarios').get().n], counts);
});

test('demo scenarios span full, partial, unallocated, split, pending, rejected and unpublished cases', async t => {
  const db = fixture(t);
  seedDemo(db);
  const server = createApp(db).listen(0,'127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const directory = await (await fetch(base + '/public-organizations')).json();
  assert.ok(directory.organizations.length >= 18);
  assert.ok(!directory.organizations.some(o => o.slug === 'hidden-pilot'));
  const scenarios = await (await fetch(base + '/demo-scenarios')).json();
  assert.ok(scenarios.scenarios.length >= 54);
  assert.ok(scenarios.scenarios.every(c => c.synthetic === true));
  for (const kind of ['full','partial','unallocated','split','allocated_no_expense','rejected']) {
    const sample = scenarios.scenarios.find(c => c.kind === kind && c.published);
    assert.ok(sample, `missing ${kind}`);
    const preview = await (await fetch(`${base}/demo-scenarios/${sample.slug}/${sample.bankReference}`)).json();
    assert.equal(preview.donation.amount, sample.amount);
    assert.equal(preview.demoPreview, true);
    if (kind === 'unallocated') assert.equal(preview.unallocated, sample.amount);
    if (kind === 'full') { assert.equal(preview.unallocated, 0); assert.ok(preview.allocations.some(a => a.programExpenseCount > 0)); }
    if (kind === 'partial') assert.ok(preview.unallocated > 0 && preview.unallocated < sample.amount);
    if (kind === 'split') assert.ok(preview.allocations.length >= 2);
    if (kind === 'allocated_no_expense' || kind === 'rejected') assert.ok(preview.allocations.every(a => a.programExpenseCount === 0));
  }
  const hidden = scenarios.scenarios.find(c => !c.published);
  assert.equal(hidden, undefined);
  assert.equal((await fetch(`${base}/public/hidden-pilot`)).status, 404);
  const unmatched = db.prepare("SELECT b.reference FROM bank_transactions b JOIN orgs o ON o.id=b.org_id WHERE o.slug='baan-oon' AND b.matched_journal_id IS NULL AND b.direction='in'").get();
  assert.ok(unmatched);
  assert.equal((await fetch(`${base}/public/baan-oon/claim`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({bankReference:unmatched.reference,amount:7500})})).status,404);
});

test('existing demo database gains cases without replacing existing donations or user-created organizations', t => {
  const db = fixture(t);
  const existing = id();
  db.prepare('INSERT INTO orgs VALUES (?,?,?,?,?)').run(existing,'มูลนิธิแสงใหม่','saengmai',1,new Date().toISOString());
  db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,1)').run(id(),existing,'admin@demo.routhun.test','ผู้ดูแลระบบ','admin',passwordHash('RouthunDemo2027!'));
  const own = id();
  db.prepare('INSERT INTO orgs VALUES (?,?,?,?,?)').run(own,'มูลนิธิของผู้ใช้','my-foundation',0,new Date().toISOString());
  assert.equal(seedDemo(db), true);
  assert.equal(db.prepare("SELECT id FROM orgs WHERE slug='saengmai'").get().id, existing);
  assert.equal(db.prepare("SELECT id FROM orgs WHERE slug='my-foundation'").get().id, own);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM demo_scenarios').get().n >= 54, true);
});
