import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('backend build does not accidentally publish the generated demo snapshot',()=>{
 const script="import('./vite.config.js').then(({default:config})=>console.log(JSON.stringify(config.publicDir)))";
 const normal=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:process.cwd(),encoding:'utf8',env:{...process.env,VITE_STATIC_DEMO:'false'}});
 assert.equal(normal.status,0,normal.stderr);assert.equal(normal.stdout.trim(),'false');
 const demo=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:process.cwd(),encoding:'utf8',env:{...process.env,VITE_STATIC_DEMO:'true'}});
 assert.equal(demo.status,0,demo.stderr);assert.equal(demo.stdout.trim(),'"public"');
});

test('static snapshot is generated solely from synthetic seed with role data and public previews',()=>{
 const dir=mkdtempSync(join(tmpdir(),'routhun-static-'));
 try {
  const path=join(dir,'demo-data.json');
  const run=spawnSync(process.execPath,['scripts/generate-static-demo.mjs',path],{cwd:process.cwd(),encoding:'utf8',env:{...process.env,NODE_ENV:'production',DEMO_MODE:'false',DB_PATH:':memory:'},timeout:60000});
  assert.equal(run.status,0,run.stderr);
  const data=JSON.parse(readFileSync(path,'utf8'));
  assert.equal(data.accounts.length,5);
  assert.ok(data.public['/public-organizations'].organizations.length>=19);
  assert.ok(data.public['/demo-scenarios'].scenarios.length>=57);
  assert.ok(data.roles.admin['/dashboard'].summary);
  assert.ok(data.roles.board['/expenses'].expenses);
  assert.ok(data.roles.auditor['/reports'].months);
  const sample=data.public['/demo-scenarios'].scenarios[0];
  assert.equal(data.public[`/demo-scenarios/${sample.slug}/${sample.bankReference}`].demoPreview,true);
  assert.equal(data.public['/public/hidden-pilot'],undefined);
  assert.doesNotMatch(JSON.stringify(data),/password_hash|ciphertext|token_hash|rt_session/);
 } finally {rmSync(dir,{recursive:true,force:true});}
});
