import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase, seedDemo, id, passwordHash } from '../db.mjs';
import { merkle, proof, verifyProof, sha256, leafHash } from '../crypto.mjs';
import { verifyPublicReceipt } from '../../src/verify.js';
import { createApp } from '../index.mjs';

const base='http://127.0.0.1';
async function setup(t){const db=openDatabase(':memory:');seedDemo(db);const server=createApp(db).listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));t.after(()=>{server.close();db.close()});return {db,url:`${base}:${server.address().port}`};}
async function call(url,path,{method='GET',cookie,body}={}){const response=await fetch(url+'/api'+path,{method,headers:{...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
async function login(url,role){const r=await call(url,'/auth/login',{method:'POST',body:{email:`${role}@demo.routhun.test`,password:'RouthunDemo2027!'}});assert.equal(r.status,200);return r.cookie;}

test('demo login accepts loopback website origins but rejects external origins',async t=>{
 const {url}=await setup(t);
 const body={email:'admin@demo.routhun.test',password:'RouthunDemo2027!'};
 for (const origin of ['http://localhost:5173','http://127.0.0.1:3001','http://localhost:3001']) {
   const response=await fetch(url+'/api/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
   assert.equal(response.status,200,`login rejected ${origin}: ${await response.text()}`);
 }
 const outside=await fetch(url+'/api/auth/login',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:JSON.stringify(body)});
 assert.equal(outside.status,403);
});

test('donor browser recomputes public receipt and detects changed amount',async()=>{
 const db=openDatabase(':memory:');seedDemo(db);const j=db.prepare("SELECT * FROM journals WHERE reference='RT-DEMO-IN-001'").get();
 const record={id:j.id,org_id:j.org_id,kind:j.kind,amount:j.amount,reference:j.reference,evidence_hash:null,posted_at:j.posted_at};
 const p={leaf:leafHash(j),root:leafHash(j),path:[]};
 assert.equal(await verifyPublicReceipt(record,p),true);
 assert.equal(await verifyPublicReceipt({...record,amount:j.amount+100},p),false);
 db.close();
});

test('Merkle proof verifies all leaves, rejects tampering and wrong order',()=>{const leaves=['a','b','c','d','e'].map(sha256);const tree=merkle(leaves);for(let i=0;i<leaves.length;i++)assert.equal(verifyProof(leaves[i],proof(tree.levels,i),tree.root),true);assert.equal(verifyProof(sha256('other'),proof(tree.levels,0),tree.root),false);assert.equal(verifyProof(leaves[0],[{hash:leaves[1],side:'left'}],tree.root),false);});
test('demo login, two independent approvals, balanced journal, anchor proof',async t=>{const {db,url}=await setup(t);const staff=await login(url,'staff'),board1=await login(url,'board1'),board2=await login(url,'board2'),admin=await login(url,'admin');
 const expenses=await call(url,'/expenses',{cookie:staff});const expense=expenses.body.expenses[0];assert.equal(expense.status,'pending');
 const wrong=await call(url,`/expenses/${expense.id}/decision`,{method:'POST',cookie:staff,body:{decision:'approve'}});assert.equal(wrong.status,403);
 const one=await call(url,`/expenses/${expense.id}/decision`,{method:'POST',cookie:board1,body:{decision:'approve'}});assert.equal(one.body.status,'pending');
 const duplicate=await call(url,`/expenses/${expense.id}/decision`,{method:'POST',cookie:board1,body:{decision:'approve'}});assert.equal(duplicate.status,409);
 const two=await call(url,`/expenses/${expense.id}/decision`,{method:'POST',cookie:board2,body:{decision:'approve'}});assert.equal(two.body.status,'approved');
 const journal=db.prepare('SELECT * FROM journals WHERE reference=?').get(`RT-EXP-${expense.id}`);assert.ok(journal);const sums=db.prepare('SELECT SUM(debit) d,SUM(credit) c FROM ledger_entries WHERE journal_id=?').get(journal.id);assert.equal(sums.d,sums.c);
 const batch=await call(url,'/anchors/run',{method:'POST',cookie:admin});assert.equal(batch.status,201);assert.equal(batch.body.batch.status,'local');assert.equal(batch.body.count,5);
 const p=await call(url,`/proof/${encodeURIComponent(journal.reference)}`,{cookie:staff});assert.equal(p.body.proof.locallyValid,true);assert.equal(p.body.proof.status,'local');assert.equal(verifyProof(leafHash(p.body.journal),p.body.proof.path,p.body.proof.root),true);
 const check=await call(url,`/proof/${encodeURIComponent(journal.reference)}/check`,{cookie:staff});assert.deepEqual([check.body.local,check.body.onchain],[true,null]);
 const repeat=await call(url,'/anchors/run',{method:'POST',cookie:admin});assert.equal(repeat.status,409);
});
test('evidence encryption, expense matching, tenant isolation, public privacy',async t=>{const {db,url}=await setup(t);const staff=await login(url,'staff'),board=await login(url,'board1');const bank=await call(url,'/bank',{cookie:staff});const unmatched=bank.body.transactions.find(x=>x.reference==='DEMO-OUT-003');
 const pdf=Buffer.from('%PDF-1.4\nTEST DOCUMENT\n%%EOF');const uploaded=await call(url,'/evidence',{method:'POST',cookie:staff,body:{name:'test.pdf',mime:'application/pdf',base64:pdf.toString('base64')}});assert.equal(uploaded.status,201);assert.equal(uploaded.body.hash,sha256(pdf));const stored=db.prepare('SELECT * FROM evidence WHERE id=?').get(uploaded.body.id);assert.notEqual(stored.ciphertext.toString(),pdf.toString());
 const created=await call(url,'/expenses',{method:'POST',cookie:staff,body:{title:'ตัวอย่างเวชภัณฑ์',purpose:'งานสาธารณะ',amount:unmatched.amount,bankId:unmatched.id,evidenceId:uploaded.body.id}});assert.equal(created.status,201);
 const second=await call(url,'/expenses',{method:'POST',cookie:staff,body:{title:'ซ้ำ',purpose:'งาน',amount:unmatched.amount,bankId:unmatched.id,evidenceId:uploaded.body.id}});assert.equal(second.status,400);
 const otherOrg=id();db.prepare('INSERT INTO orgs VALUES (?,?,?,?,?)').run(otherOrg,'Other','other',0,new Date().toISOString());const otherId=id();db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,1)').run(otherId,otherOrg,'other@example.test','Other','board',passwordHash('DifferentDemoPass2027!'));const other=await call(url,'/auth/login',{method:'POST',body:{email:'other@example.test',password:'DifferentDemoPass2027!'}});
 const cross=await call(url,`/expenses/${created.body.id}/decision`,{method:'POST',cookie:other.cookie,body:{decision:'approve'}});assert.equal(cross.status,404);
 const pub=await call(url,'/public/saengmai');assert.equal(pub.status,200); assert.equal(pub.body.donations.length,0);assert.equal(JSON.stringify(pub.body).includes('RT-DEMO-IN'),false);assert.equal(JSON.stringify(pub.body).includes('receipt-demo'),false);assert.equal(JSON.stringify(pub.body).includes('DEMO-OUT'),false);
 const hidden=await call(url,'/public/other');assert.equal(hidden.status,404);
 const orgs=await call(url,'/public-organizations');assert.ok(orgs.body.organizations.length>=18);assert.ok(orgs.body.organizations.some(o=>o.name==='มูลนิธิแสงใหม่'&&o.slug==='saengmai'));assert.ok(!orgs.body.organizations.some(o=>o.slug==='hidden-pilot'));
});
test('donor claims only a matched incoming bank transfer and follows honest allocation status',async t=>{
 const {url}=await setup(t);
 const wrong=await call(url,'/public/saengmai/claim',{method:'POST',body:{bankReference:'DEMO-IN-002',amount:10000}});
 assert.equal(wrong.status,404);
 const expense=await call(url,'/public/saengmai/claim',{method:'POST',body:{bankReference:'DEMO-OUT-001',amount:32000}});
 assert.equal(expense.status,404);
 const claimed=await call(url,'/public/saengmai/claim',{method:'POST',body:{bankReference:'DEMO-IN-002',amount:50000}});
 assert.equal(claimed.status,201);assert.ok(claimed.body.token.length>=40);
 const duplicate=await call(url,'/public/saengmai/claim',{method:'POST',body:{bankReference:'DEMO-IN-002',amount:50000}});
 assert.equal(duplicate.status,409);assert.equal(JSON.stringify(duplicate.body).includes(claimed.body.token),false);
 const denied=await call(url,'/tracking',{method:'POST',body:{token:'bad-token'}});assert.equal(denied.status,404);
 const initial=await call(url,'/tracking',{method:'POST',body:{token:claimed.body.token}});
 assert.equal(initial.status,200);assert.equal(initial.body.donation.amount,50000);assert.equal(initial.body.unallocated,50000);assert.deepEqual(initial.body.allocations,[]);
 assert.equal(Object.hasOwn(initial.body,'bankReference'),false);
 const staff=await login(url,'staff');
 const allocation=await call(url,'/allocations',{method:'POST',cookie:staff,body:{donationReference:'RT-DEMO-IN-002',purpose:'ทุนการศึกษา',amount:30000}});
 assert.equal(allocation.status,201);
 const over=await call(url,'/allocations',{method:'POST',cookie:staff,body:{donationReference:'RT-DEMO-IN-002',purpose:'อาหารกลางวัน',amount:30000}});
 assert.equal(over.status,400);
 const tracked=await call(url,'/tracking',{method:'POST',body:{token:claimed.body.token}});
 assert.equal(tracked.body.unallocated,20000);assert.equal(tracked.body.allocations[0].purpose,'ทุนการศึกษา');
 assert.equal(tracked.body.allocations[0].amount,30000);assert.equal(tracked.body.allocations[0].programExpenses,0);
});
