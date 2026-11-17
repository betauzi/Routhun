// Browser-side verifier: recomputes the receipt leaf and every Merkle parent.
// The root is still only externally trustworthy when independently checked on Ethereum.
const enc = new TextEncoder();
const stable = value => Array.isArray(value) ? `[${value.map(stable).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value);
const bytes = hex => Uint8Array.from(hex.match(/../g) || [], part => parseInt(part,16));
const digest = async data => [...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(x=>x.toString(16).padStart(2,'0')).join('');
export async function verifyPublicReceipt(record, proof) {
  if (!record || !proof || !/^[a-f0-9]{64}$/.test(proof.root) || !Array.isArray(proof.path) || proof.path.length>64) return false;
  const receipt={id:record.id,orgId:record.org_id,kind:record.kind,amount:record.amount,reference:record.reference,evidenceHash:record.evidence_hash || null,postedAt:record.posted_at};
  let leaf=await digest(enc.encode(`routhun:journal:v1:${stable(receipt)}`));
  if (leaf !== proof.leaf) return false;
  for (const step of proof.path){
    if(!/^[a-f0-9]{64}$/.test(step.hash)||!['left','right'].includes(step.side))return false;
    const left=step.side==='left'?step.hash:leaf,right=step.side==='left'?leaf:step.hash;
    const prefix=enc.encode('routhun:node:v1:'),input=new Uint8Array(prefix.length+64);
    input.set(prefix);input.set(bytes(left),prefix.length);input.set(bytes(right),prefix.length+32);
    leaf=await digest(input);
  }
  return leaf===proof.root;
}
