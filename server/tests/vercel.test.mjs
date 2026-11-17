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
test('Vercel without a backend builds an explicit read-only static demo', () => {
 const script="import('./vercel.mjs').then(({config})=>console.log(JSON.stringify(config)))";
 const run=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:process.cwd(),env:{...process.env,VERCEL:'1',BACKEND_ORIGIN:''},encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);
 const config=JSON.parse(run.stdout.trim());
 assert.equal(config.buildCommand,'npm run build:demo');
 assert.equal(config.rewrites.some(rule=>rule.source.startsWith('/api/')),false);
 assert.equal(config.rewrites.at(-1).destination,'/index.html');
});
test('Vercel still rejects an insecure backend origin', () => {
 const script="import('./vercel.mjs')";
 const insecure=spawnSync(process.execPath,['--input-type=module','-e',script],{cwd:process.cwd(),env:{...process.env,VERCEL:'1',BACKEND_ORIGIN:'http://example.test'},encoding:'utf8'});
 assert.notEqual(insecure.status,0);assert.match(insecure.stderr,/bare HTTPS origin/);
});
