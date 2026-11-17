import { readFileSync } from 'node:fs';
import { leafHash, verifyProof } from './crypto.mjs';
import { chainConfigured, readRoot } from './chain.mjs';

const path=process.argv[2];
if(!path){console.error('Usage: node server/verify-proof.mjs proof.json');process.exit(2)}
const bundle=JSON.parse(readFileSync(path,'utf8'));
const record=bundle.journal||bundle.record;
if(!record||!bundle.proof){console.error('Missing journal/record or proof');process.exit(2)}
const leaf=leafHash(record), p=bundle.proof;
const local=leaf===p.leaf && verifyProof(leaf,p.path,p.root);
console.log(JSON.stringify({reference:record.reference,local,claimedOnChain:p.status==='confirmed',root:p.root,batchId:p.batchId},null,2));
if(!local)process.exitCode=1;
if(chainConfigured()){
 try{const root=await readRoot(p.batchId),matches=root?.toLowerCase()===`0x${p.root}`;console.log(JSON.stringify({onchainRoot:root,matches},null,2));if(!matches)process.exitCode=1}
 catch(e){console.error('On-chain verification failed:',e.message);process.exitCode=1}
}
