// Build a public read-only snapshot from a fresh in-memory synthetic database.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { openDatabase, seedDemo } from '../server/db.mjs';

// Never touch DB_PATH or any existing database, even if Vercel sets one.
process.env.DEMO_MODE='true';
process.env.EVIDENCE_KEY='0'.repeat(64); // throwaway for the seed; never exported
const { createApp }=await import('../server/index.mjs');
const db=openDatabase(':memory:');
seedDemo(db);
const server=createApp(db).listen(0,'127.0.0.1');
try {
  await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api`;
  const get=async(path,cookie)=>{
    const result=await fetch(base+path,{headers:cookie?{Cookie:cookie}:{}});
    if (!result.ok) throw Error(`Synthetic API ${path}: HTTP ${result.status}`);
    return result.json();
  };
  const publicRoutes=['/health','/public-organizations','/demo-scenarios'];
  const publicData={};
  for(const path of publicRoutes) publicData[path]=await get(path);
  for(const {slug} of publicData['/public-organizations'].organizations) publicData[`/public/${slug}`]=await get(`/public/${encodeURIComponent(slug)}`);
  for(const {slug,bankReference} of publicData['/demo-scenarios'].scenarios) {
    const path=`/demo-scenarios/${encodeURIComponent(slug)}/${encodeURIComponent(bankReference)}`;
    publicData[path]=await get(path);
  }
  const published=db.prepare('SELECT id,slug FROM orgs WHERE published=1').all();
  for(const org of published){
    const refs=db.prepare("SELECT reference FROM journals WHERE org_id=? AND kind='donation'").all(org.id);
    for(const {reference} of refs){const path=`/public/${encodeURIComponent(org.slug)}/proof/${encodeURIComponent(reference)}`;publicData[path]=await get(path);}
  }
  const accounts=db.prepare("SELECT u.id,u.email,u.name,u.role,o.id AS orgId,o.name AS orgName,o.slug AS orgSlug,o.published AS orgPublished FROM users u JOIN orgs o ON o.id=u.org_id WHERE o.slug='saengmai' ORDER BY u.role,u.email").all().map(user=>({...user,orgPublished:Boolean(user.orgPublished)}));
  const roles={};
  const pagesByRole={admin:['/dashboard','/ledger','/bank','/allocations','/expenses','/anchors','/reports','/audit','/team'],staff:['/dashboard','/ledger','/bank','/allocations','/expenses','/anchors','/reports'],board:['/dashboard','/expenses','/reports','/audit'],auditor:['/dashboard','/ledger','/expenses','/anchors','/reports','/audit']};
  for(const [role,paths] of Object.entries(pagesByRole)){
    const account=accounts.find(user=>user.role===role);
    const login=await fetch(base+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:account.email,password:'RouthunDemo2027!'})});
    if(!login.ok) throw Error(`Synthetic login failed for ${role}`);
    const cookie=login.headers.get('set-cookie')?.split(';')[0];
    roles[role]={};
    for(const path of paths) roles[role][path]=await get(path,cookie);
    for(const journal of roles[role]['/ledger']?.journals||[]){
      const path=`/proof/${encodeURIComponent(journal.reference)}`;
      roles[role][path]=await get(path,cookie);
      roles[role][path+'/check']=await get(path+'/check',cookie);
    }
  }
  const output=resolve(process.argv[2]||'public/demo-data.json');
  mkdirSync(dirname(output),{recursive:true});
  writeFileSync(output,JSON.stringify({accounts,public:publicData,roles}));
  console.log(`Generated synthetic read-only demo: ${accounts.length} accounts, ${published.length} organizations, ${publicData['/demo-scenarios'].scenarios.length} previews`);
} finally {
  await new Promise(resolve=>server.close(resolve));
  db.close();
}
