import { createHash } from 'node:crypto';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const leafHash = journal => sha256(`routhun:journal:v1:${stable({ id: journal.id, orgId: journal.org_id, kind: journal.kind, amount: journal.amount, reference: journal.reference, evidenceHash: journal.evidence_hash || null, postedAt: journal.posted_at })}`);
export const parentHash = (left, right) => sha256(Buffer.concat([Buffer.from('routhun:node:v1:'), Buffer.from(left, 'hex'), Buffer.from(right, 'hex')]));
export function merkle(leaves) {
  if (!leaves.length) throw new Error('Empty batch');
  const levels = [leaves];
  while (levels.at(-1).length > 1) {
    const row = levels.at(-1), next = [];
    for (let i = 0; i < row.length; i += 2) next.push(parentHash(row[i], row[i + 1] || row[i]));
    levels.push(next);
  }
  return { root: levels.at(-1)[0], levels };
}
export function proof(levels, index) {
  if (index < 0 || index >= levels[0].length) throw new Error('Invalid leaf index');
  const steps = [];
  for (let level = 0; level < levels.length - 1; level++) {
    const row = levels[level], other = index ^ 1;
    steps.push({ hash: row[other] || row[index], side: index % 2 ? 'left' : 'right' });
    index = Math.floor(index / 2);
  }
  return steps;
}
export function verifyProof(leaf, steps, root) {
  if (!/^[a-f0-9]{64}$/.test(leaf) || !/^[a-f0-9]{64}$/.test(root) || !Array.isArray(steps)) return false;
  try { return steps.reduce((hash, s) => s.side === 'left' ? parentHash(s.hash, hash) : s.side === 'right' ? parentHash(hash, s.hash) : (() => { throw Error('side'); })(), leaf) === root; }
  catch { return false; }
}
