import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('Vercel config proxies API to the persistent backend and serves SPA deep links', () => {
 const script="import('./vercel.mjs').then(({config})=>console.log(JSON.stringify(config.rewrites)))";
 const run=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:process.cwd(),env:{...process.env,BACKEND_ORIGIN:'https://api.example.test'},encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);
 const rewrites=JSON.parse(run.stdout.trim());
 assert.equal(rewrites[0].source,'/api/:path*');
 assert.match(rewrites[0].destination,/^https:\/\/api\.example\.test\/api\//);
 assert.equal(rewrites.at(-1).destination,'/index.html');
});
test('Vercel deployment fails closed without a persistent HTTPS API origin', () => {
 const script="import('./vercel.mjs')";
 const missing=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:process.cwd(),env:{...process.env,VERCEL:'1',BACKEND_ORIGIN:''},encoding:'utf8'});
 assert.notEqual(missing.status,0);assert.match(missing.stderr,/Set BACKEND_ORIGIN/);
 const insecure=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:process.cwd(),env:{...process.env,VERCEL:'1',BACKEND_ORIGIN:'http://example.test'},encoding:'utf8'});
 assert.notEqual(insecure.status,0);assert.match(insecure.stderr,/bare HTTPS origin/);
});
