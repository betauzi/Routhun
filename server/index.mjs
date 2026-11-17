import express from 'express';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { audit, id, now, openDatabase, passwordHash, passwordValid, postJournal, seedDemo } from './db.mjs';
import { leafHash, merkle, proof, sha256, stable, verifyProof } from './crypto.mjs';
import { chainConfigured, readRoot, submitAnchor } from './chain.mjs';
import { registerTracking, trackingForDonation } from './tracking.mjs';

const demo = process.env.DEMO_MODE === 'true' || (process.env.NODE_ENV !== 'production' && process.env.DEMO_MODE !== 'false');
function evidenceKey() {
  if (process.env.EVIDENCE_KEY) { if (!/^[a-f0-9]{64}$/i.test(process.env.EVIDENCE_KEY)) throw Error('EVIDENCE_KEY must be 32-byte hex'); return Buffer.from(process.env.EVIDENCE_KEY,'hex'); }
  if (!demo) throw Error('Set EVIDENCE_KEY in production');
  const path=resolve('./data/demo-evidence.key'); mkdirSync(resolve('./data'),{recursive:true});
  if (!existsSync(path)) writeFileSync(path,randomBytes(32).toString('hex'),{mode:0o600,flag:'wx'});
  return Buffer.from(readFileSync(path,'utf8').trim(),'hex');
}
const key=evidenceKey();
const invalid=(res,msg,status=400)=>res.status(status).json({error:msg});
const present=row=>row && ({id:row.id,name:row.name,email:row.email,role:row.role,orgId:row.org_id,orgName:row.org_name,orgSlug:row.org_slug,orgPublished:Boolean(row.org_published)});
const currency=x=>Number.isSafeInteger(Number(x)) && Number(x)>0 && Number(x)<=100000000000;
const trim=(value,max=160)=>typeof value==='string' ? value.trim().slice(0,max) : '';
const only=(...roles)=>(req,res,next)=>req.user && roles.includes(req.user.role) ? next() : invalid(res,'ไม่มีสิทธิ์ดำเนินการ',403);
function transaction(db, fn) { db.exec('BEGIN IMMEDIATE'); try { const result=fn(); db.exec('COMMIT'); return result; } catch(e) { db.exec('ROLLBACK'); throw e; } }
function rowSet(db,sql,...params) { return db.prepare(sql).all(...params); }

export function createApp(db) {
  const app=express(); app.disable('x-powered-by'); app.set('trust proxy',process.env.TRUST_PROXY==='true' ? 1 : false); app.use(express.json({limit:'4mb'}));
  app.use((req,res,next)=>{ res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','strict-origin-when-cross-origin'); res.setHeader('X-Frame-Options','DENY'); res.setHeader('Cache-Control','no-store'); next(); });
  app.use('/api',(req,res,next)=>{
    if (!['GET','HEAD','OPTIONS'].includes(req.method) && req.headers.origin) {
      const configured=process.env.PUBLIC_ORIGIN;
      const allowed=configured ? [configured] : demo ? ['http://127.0.0.1:5173','http://localhost:5173',`http://127.0.0.1:${process.env.PORT||3001}`,`http://localhost:${process.env.PORT||3001}`] : [];
      if (!allowed.includes(req.headers.origin)) return invalid(res,'Origin ไม่ได้รับอนุญาต',403);
    }
    const token=/(?:^|;\s*)rt_session=([^;]+)/.exec(req.headers.cookie||'')?.[1];
    if (token) req.user=db.prepare('SELECT u.*,o.name AS org_name,o.slug AS org_slug,o.published AS org_published FROM sessions s JOIN users u ON u.id=s.user_id JOIN orgs o ON o.id=u.org_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1').get(sha256(token),now());
    next();
  });
  app.get('/api/health',(_req,res)=>res.json({ok:true,demo,chainConfigured:chainConfigured(),chainWritesEnabled:process.env.ENABLE_CHAIN_WRITES==='true'}));
  const attempts=new Map();
  app.post('/api/auth/login',(req,res)=>{
    const ip=req.ip, t=Date.now(), recent=(attempts.get(ip)||[]).filter(x=>t-x<60000);
    if (recent.length>=8) return invalid(res,'ลองใหม่ในอีกหนึ่งนาที',429);
    recent.push(t); attempts.set(ip,recent);
    const email=trim(req.body.email,255).toLowerCase(),password=req.body.password;
    const user=db.prepare('SELECT u.*,o.name AS org_name,o.slug AS org_slug,o.published AS org_published FROM users u JOIN orgs o ON o.id=u.org_id WHERE email=? AND u.active=1').get(email);
    if (!user || typeof password!=='string' || !passwordValid(password,user.password_hash)) return invalid(res,'อีเมลหรือรหัสผ่านไม่ถูกต้อง',401);
    attempts.delete(ip); const token=randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(sha256(token),user.id,new Date(Date.now()+8*3600000).toISOString());
    res.cookie('rt_session',token,{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',path:'/',maxAge:8*3600000});
    audit(db,user.org_id,user.id,'login','session',{role:user.role}); res.json({user:present(user)});
  });
  app.post('/api/auth/logout',(req,res)=>{ const token=/(?:^|;\s*)rt_session=([^;]+)/.exec(req.headers.cookie||'')?.[1]; if(token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(sha256(token)); res.clearCookie('rt_session',{path:'/'}); res.json({ok:true}); });
  app.get('/api/me',(req,res)=>res.json({user:present(req.user)||null,demo}));
  app.get('/api/demo-accounts',(_req,res)=>res.json({accounts:demo?rowSet(db,"SELECT u.email,u.name,u.role FROM users u JOIN orgs o ON o.id=u.org_id WHERE o.slug='saengmai' ORDER BY u.role,u.email"):[],password:demo?'RouthunDemo2027!':null}));
  const auth=(req,res,next)=>req.user?next():invalid(res,'กรุณาเข้าสู่ระบบ',401);
  app.post('/api/auth/change-password',auth,(req,res)=>{
    const {currentPassword,newPassword}=req.body;
    if(typeof currentPassword!=='string'||typeof newPassword!=='string'||newPassword.length<14||newPassword.length>256||!passwordValid(currentPassword,req.user.password_hash)) return invalid(res,'รหัสผ่านเดิมไม่ถูกต้อง หรือรหัสใหม่ต้องยาวอย่างน้อย 14 ตัวอักษร');
    transaction(db,()=>{db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(passwordHash(newPassword),req.user.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.user.id);audit(db,req.user.org_id,req.user.id,'user.password.change',req.user.id,{});});
    res.clearCookie('rt_session',{path:'/'});res.json({ok:true,requiresLogin:true});
  });
  app.get('/api/team',auth,only('admin'),(req,res)=>res.json({members:rowSet(db,'SELECT id,email,name,role,active FROM users WHERE org_id=? ORDER BY role,name',req.user.org_id),organization:db.prepare('SELECT id,name,slug,published FROM orgs WHERE id=?').get(req.user.org_id)}));
  app.post('/api/team',auth,only('admin'),(req,res)=>{
    const email=trim(req.body.email,255).toLowerCase(),name=trim(req.body.name,100),role=req.body.role,password=req.body.password;
    if(!/^\S+@\S+\.\S+$/.test(email)||!name||!['staff','board','auditor','admin'].includes(role)||typeof password!=='string'||password.length<14||password.length>256) return invalid(res,'ระบุชื่อ อีเมล บทบาท และรหัสผ่านอย่างน้อย 14 ตัวอักษร');
    if(db.prepare('SELECT 1 FROM users WHERE email=?').get(email))return invalid(res,'อีเมลนี้มีอยู่แล้ว',409);
    const uid=id();transaction(db,()=>{db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,1)').run(uid,req.user.org_id,email,name,role,passwordHash(password));audit(db,req.user.org_id,req.user.id,'team.create',uid,{role,email});});res.status(201).json({id:uid});
  });
  app.post('/api/team/:id/active',auth,only('admin'),(req,res)=>{
    if(req.params.id===req.user.id)return invalid(res,'ปิดบัญชีตนเองไม่ได้');
    if(typeof req.body.active!=='boolean')return invalid(res,'ระบุสถานะ true/false');
    const target=db.prepare('SELECT * FROM users WHERE id=? AND org_id=?').get(req.params.id,req.user.org_id);if(!target)return invalid(res,'ไม่พบบัญชี',404);
    transaction(db,()=>{db.prepare('UPDATE users SET active=? WHERE id=?').run(req.body.active?1:0,target.id);if(!req.body.active)db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);audit(db,req.user.org_id,req.user.id,'team.active',target.id,{active:req.body.active});});res.json({ok:true});
  });
  app.post('/api/organization/publish',auth,only('admin'),(req,res)=>{
    if(typeof req.body.published!=='boolean')return invalid(res,'ระบุสถานะ true/false');
    transaction(db,()=>{db.prepare('UPDATE orgs SET published=? WHERE id=?').run(req.body.published?1:0,req.user.org_id);audit(db,req.user.org_id,req.user.id,'organization.publish',req.user.org_id,{published:req.body.published});});res.json({published:req.body.published});
  });
  app.get('/api/dashboard',auth,(req,res)=>{
    const org=req.user.org_id;
    const sums=db.prepare("SELECT COALESCE(SUM(CASE WHEN kind='donation' THEN amount ELSE 0 END),0) AS income,COALESCE(SUM(CASE WHEN kind='expense' THEN amount ELSE 0 END),0) AS expenses,COUNT(*) AS journals FROM journals WHERE org_id=?").get(org);
    const pending=db.prepare("SELECT COUNT(*) AS n FROM expenses WHERE org_id=? AND status='pending'").get(org).n;
    const unmatched=db.prepare("SELECT COUNT(*) AS n FROM bank_transactions WHERE org_id=? AND matched_journal_id IS NULL").get(org).n;
    const anchors=db.prepare('SELECT COUNT(*) AS n FROM batch_items i JOIN journals j ON j.id=i.journal_id WHERE j.org_id=?').get(org).n;
    res.json({summary:{...sums,balance:sums.income-sums.expenses,pending,unmatched,anchored:anchors},recent:rowSet(db,'SELECT id,kind,title,amount,reference,posted_at FROM journals WHERE org_id=? ORDER BY posted_at DESC,rowid DESC LIMIT 6',org)});
  });
  app.get('/api/ledger',auth,(req,res)=>res.json({journals:rowSet(db,`SELECT j.*,b.status AS anchor_status,b.tx_hash FROM journals j LEFT JOIN batch_items bi ON bi.journal_id=j.id LEFT JOIN batches b ON b.id=bi.batch_id WHERE j.org_id=? ORDER BY j.posted_at DESC,j.rowid DESC`,req.user.org_id), entries:rowSet(db,'SELECT e.* FROM ledger_entries e WHERE e.org_id=? ORDER BY e.rowid DESC LIMIT 200',req.user.org_id)}));
  app.get('/api/bank',auth,(req,res)=>res.json({transactions:rowSet(db,'SELECT * FROM bank_transactions WHERE org_id=? ORDER BY happened_at DESC,rowid DESC',req.user.org_id)}));
  app.post('/api/bank',auth,only('staff','admin'),(req,res)=>{
    if(!demo) return invalid(res,'ยังไม่ได้เชื่อมผู้ให้บริการ Bank API; ไม่รับรายการจำลองใน production',501);
    const {direction,amount}=req.body,description=trim(req.body.description),ref=`TEST-${Date.now()}-${randomBytes(3).toString('hex')}`;
    if(!['in','out'].includes(direction)||!currency(amount)||!description) return invalid(res,'ระบุประเภท จำนวนเงิน (สตางค์) และคำอธิบาย');
    const bankId=id(); transaction(db,()=>{ db.prepare('INSERT INTO bank_transactions (id,org_id,direction,amount,description,happened_at,reference) VALUES (?,?,?,?,?,?,?)').run(bankId,req.user.org_id,direction,amount,description,now(),ref);
      if(direction==='in') postJournal(db,{orgId:req.user.org_id,kind:'donation',amount,reference:`RT-${ref}`,bankId,title:description});
      audit(db,req.user.org_id,req.user.id,'demo.bank.import',bankId,{direction,amount,ref}); });
    res.status(201).json({id:bankId,reference:ref,simulated:true});
  });
  app.post('/api/evidence',auth,only('staff','admin'),(req,res)=>{
    const {name,mime,base64}=req.body, safeName=trim(name,120);
    if(!safeName||!['application/pdf','image/png','image/jpeg'].includes(mime)||typeof base64!=='string'||base64.length>2800000||!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return invalid(res,'ไฟล์ไม่ถูกต้อง (PDF/PNG/JPEG สูงสุด 2 MB)');
    const bytes=Buffer.from(base64,'base64');
    const magic=(mime==='application/pdf'&&bytes.subarray(0,5).toString()==='%PDF-')||(mime==='image/png'&&bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))||(mime==='image/jpeg'&&bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex')));
    if(!magic||!bytes.length||bytes.length>2*1024*1024) return invalid(res,'ชนิดไฟล์หรือขนาดไม่ถูกต้อง');
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),ciphertext=Buffer.concat([cipher.update(bytes),cipher.final()]),tag=cipher.getAuthTag(),eid=id(),hash=sha256(bytes);
    db.prepare('INSERT INTO evidence VALUES (?,?,?,?,?,?,?,?,?)').run(eid,req.user.org_id,safeName,mime,hash,ciphertext,iv,tag,now());
    audit(db,req.user.org_id,req.user.id,'evidence.upload',eid,{hash,name:safeName}); res.status(201).json({id:eid,hash,name:safeName});
  });
  app.get('/api/evidence/:id',auth,(req,res)=>{
    const e=db.prepare('SELECT * FROM evidence WHERE id=? AND org_id=?').get(req.params.id,req.user.org_id); if(!e) return invalid(res,'ไม่พบไฟล์',404);
    const decipher=createDecipheriv('aes-256-gcm',key,e.iv);decipher.setAuthTag(e.tag);
    try { const bytes=Buffer.concat([decipher.update(e.ciphertext),decipher.final()]); if(sha256(bytes)!==e.content_hash) throw Error('digest mismatch'); res.type(e.mime).setHeader('Content-Disposition',`attachment; filename="${encodeURIComponent(e.name)}"`);res.send(bytes); }
    catch { invalid(res,'หลักฐานเสียหายหรือคีย์ไม่ถูกต้อง',500); }
  });
  app.get('/api/expenses',auth,(req,res)=>res.json({expenses:rowSet(db,`SELECT e.*, (SELECT COUNT(*) FROM approvals a WHERE a.expense_id=e.id AND a.decision='approve') AS approval_count FROM expenses e WHERE e.org_id=? ORDER BY e.created_at DESC,e.rowid DESC`,req.user.org_id),approvals:rowSet(db,'SELECT a.*,u.name AS actor FROM approvals a JOIN users u ON u.id=a.user_id WHERE a.org_id=? ORDER BY a.at DESC',req.user.org_id)}));
  app.post('/api/expenses',auth,only('staff','admin'),(req,res)=>{
    const title=trim(req.body.title),purpose=trim(req.body.purpose),amount=Number(req.body.amount),bankId=req.body.bankId,evidenceId=req.body.evidenceId;
    if(!title||!purpose||!currency(amount)||!bankId||!evidenceId) return invalid(res,'ระบุชื่อ วัตถุประสงค์ ยอด รายการธนาคาร และไฟล์หลักฐาน');
    const bank=db.prepare("SELECT * FROM bank_transactions WHERE id=? AND org_id=? AND direction='out' AND matched_journal_id IS NULL").get(bankId,req.user.org_id);
    const evidence=db.prepare('SELECT * FROM evidence WHERE id=? AND org_id=?').get(evidenceId,req.user.org_id);
    if(!bank||!evidence||bank.amount!==amount) return invalid(res,'ยอดธนาคารหรือไฟล์หลักฐานไม่ตรง หรือรายการถูกใช้แล้ว');
    if(db.prepare("SELECT 1 FROM expenses WHERE org_id=? AND bank_id=? AND status='pending'").get(req.user.org_id,bankId)) return invalid(res,'รายการธนาคารนี้มีคำขอรออนุมัติอยู่แล้ว');
    const expenseId=id(); transaction(db,()=>{ db.prepare('INSERT INTO expenses VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(expenseId,req.user.org_id,title,amount,purpose,evidenceId,evidence.name,evidence.content_hash,bankId,req.user.id,'pending',now(),null); audit(db,req.user.org_id,req.user.id,'expense.submit',expenseId,{amount,bankId,evidenceHash:evidence.content_hash}); });
    res.status(201).json({id:expenseId,status:'pending'});
  });
  app.post('/api/expenses/:id/decision',auth,only('board'),(req,res)=>{
    const decision=req.body.decision; if(!['approve','reject'].includes(decision)) return invalid(res,'การตัดสินใจไม่ถูกต้อง');
    const expense=db.prepare("SELECT * FROM expenses WHERE id=? AND org_id=? AND status='pending'").get(req.params.id,req.user.org_id);
    if(!expense) return invalid(res,'ไม่พบรายการที่รออนุมัติ',404);
    if(expense.created_by===req.user.id) return invalid(res,'ผู้สร้างรายการอนุมัติเองไม่ได้',403);
    if(db.prepare('SELECT 1 FROM approvals WHERE expense_id=? AND user_id=?').get(expense.id,req.user.id)) return invalid(res,'คุณตัดสินใจรายการนี้แล้ว',409);
    const statement=sha256(stable({expenseId:expense.id,amount:expense.amount,evidenceHash:expense.evidence_hash,bankId:expense.bank_id,decision,userId:req.user.id}));
    const result=transaction(db,()=>{
      db.prepare('INSERT INTO approvals VALUES (?,?,?,?,?,?,?)').run(id(),req.user.org_id,expense.id,req.user.id,decision,statement,now());
      let status='pending';
      if(decision==='reject') status='rejected';
      else if(db.prepare("SELECT COUNT(*) AS n FROM approvals WHERE expense_id=? AND decision='approve'").get(expense.id).n>=2) {
        const j=postJournal(db,{orgId:req.user.org_id,kind:'expense',amount:expense.amount,reference:`RT-EXP-${expense.id}`,bankId:expense.bank_id,title:expense.title,evidenceHash:sha256(stable({file:expense.evidence_hash,approvals:rowSet(db,'SELECT user_id,statement_hash,at FROM approvals WHERE expense_id=? ORDER BY at,user_id',expense.id)}))});
        db.prepare('UPDATE expenses SET journal_id=? WHERE id=?').run(j,expense.id); status='approved';
      }
      if(status!=='pending') db.prepare('UPDATE expenses SET status=? WHERE id=?').run(status,expense.id);
      audit(db,req.user.org_id,req.user.id,'expense.'+decision,expense.id,{statement,status}); return status;
    }); res.json({status:result,statementHash:statement,signatureType:'authenticated approval record; not a qualified digital signature'});
  });
  app.get('/api/anchors',auth,(req,res)=>res.json({batches:rowSet(db,'SELECT DISTINCT b.* FROM batches b JOIN batch_items i ON i.batch_id=b.id JOIN journals j ON j.id=i.journal_id WHERE j.org_id=? ORDER BY b.created_at DESC',req.user.org_id),unanchored:db.prepare('SELECT COUNT(*) AS n FROM journals j WHERE j.org_id=? AND NOT EXISTS(SELECT 1 FROM batch_items i WHERE i.journal_id=j.id)').get(req.user.org_id).n}));
  app.post('/api/anchors/run',auth,only('admin'),async(req,res)=>{
    const journals=rowSet(db,'SELECT * FROM journals j WHERE j.org_id=? AND NOT EXISTS(SELECT 1 FROM batch_items i WHERE i.journal_id=j.id) ORDER BY j.posted_at,j.id',req.user.org_id);
    if(!journals.length) return invalid(res,'ไม่มีรายการใหม่ให้ยึดหลักฐาน',409);
    const leaves=journals.map(leafHash), tree=merkle(leaves), batchId=id();
    transaction(db,()=>{
      db.prepare('INSERT INTO batches VALUES (?,?,?,?,?,?,?,?)').run(batchId,tree.root,now(),'local',null,null,null,null);
      journals.forEach((j,i)=>db.prepare('INSERT INTO batch_items VALUES (?,?,?,?)').run(batchId,j.id,leaves[i],JSON.stringify(proof(tree.levels,i))));
      audit(db,req.user.org_id,req.user.id,'anchor.batch',batchId,{root:tree.root,count:journals.length});
    });
    try { const result=await submitAnchor(batchId,tree.root); if(result.status==='confirmed') db.prepare('UPDATE batches SET status=?,chain_id=?,tx_hash=?,block_number=? WHERE id=?').run('confirmed',result.chainId,result.txHash,result.blockNumber,batchId); }
    catch(e){ db.prepare('UPDATE batches SET status=?,error=? WHERE id=?').run('failed',String(e.message).slice(0,300),batchId); }
    res.status(201).json({batch:db.prepare('SELECT * FROM batches WHERE id=?').get(batchId),count:journals.length});
  });
  app.get('/api/proof/:reference',auth,(req,res)=>{
    const j=db.prepare('SELECT * FROM journals WHERE reference=? AND org_id=?').get(req.params.reference,req.user.org_id);if(!j)return invalid(res,'ไม่พบรายการ',404);
    const item=db.prepare('SELECT i.*,b.root,b.status,b.tx_hash,b.chain_id,b.block_number,b.created_at FROM batch_items i JOIN batches b ON b.id=i.batch_id WHERE i.journal_id=?').get(j.id);
    res.json({journal:j,proof:item?{batchId:item.batch_id,root:item.root,leaf:item.leaf_hash,path:JSON.parse(item.proof_json),status:item.status,txHash:item.tx_hash,chainId:item.chain_id,blockNumber:item.block_number,anchoredAt:item.created_at,locallyValid:verifyProof(leafHash(j),JSON.parse(item.proof_json),item.root)}:null});
  });
  app.get('/api/proof/:reference/check',auth,async(req,res)=>{
    const j=db.prepare('SELECT * FROM journals WHERE reference=? AND org_id=?').get(req.params.reference,req.user.org_id);if(!j)return invalid(res,'ไม่พบรายการ',404);
    const item=db.prepare('SELECT i.*,b.root,b.status FROM batch_items i JOIN batches b ON b.id=i.batch_id WHERE i.journal_id=?').get(j.id); if(!item)return res.json({local:false,onchain:null,status:'unanchored'});
    const local=verifyProof(leafHash(j),JSON.parse(item.proof_json),item.root); let onchain=null,error=null;
    if(chainConfigured()){try{ const root=await readRoot(item.batch_id);onchain=root?.toLowerCase()===`0x${item.root}`;}catch(e){error=e.message;}}
    res.json({local,onchain,status:item.status,error});
  });
  app.get('/api/audit',auth,only('admin','auditor','board'),(req,res)=>res.json({events:rowSet(db,'SELECT a.id,a.action,a.target,a.at,a.payload_hash,a.prev_hash,a.hash,u.name AS actor FROM audit_events a LEFT JOIN users u ON u.id=a.actor_id WHERE a.org_id=? ORDER BY a.rowid DESC LIMIT 100',req.user.org_id)}));
  app.get('/api/reports',auth,(req,res)=>{
    const journals=rowSet(db,'SELECT kind,amount,posted_at,title,reference FROM journals WHERE org_id=? ORDER BY posted_at',req.user.org_id);
    const grouped={}; for(const j of journals){const month=j.posted_at.slice(0,7);grouped[month]??={month,income:0,expense:0};grouped[month][j.kind==='donation'?'income':'expense']+=j.amount;}
    res.json({months:Object.values(grouped).reverse(),reportStatus:'management draft only — not audited, not submitted to government'});
  });
  app.get('/api/reports.csv',auth,(req,res)=>{
    const rows=rowSet(db,'SELECT posted_at,reference,kind,title,amount FROM journals WHERE org_id=? ORDER BY posted_at',req.user.org_id);
    const clean=x=>`"${String(x??'').replace(/^[=+@\-\t\r]/,'\u0027$&').replaceAll('"','""')}"`;
    res.type('text/csv; charset=utf-8').setHeader('Content-Disposition','attachment; filename="routhun-ledger.csv"');res.send('\ufeff'+['date,reference,type,title,amount_thb',...rows.map(r=>[r.posted_at,r.reference,r.kind,r.title,(r.amount/100).toFixed(2)].map(clean).join(','))].join('\r\n'));
  });
  registerTracking(app,{db,auth,only,transaction:fn=>transaction(db,fn),invalid});
  app.get('/api/public-organizations',(_req,res)=>res.json({organizations:rowSet(db,'SELECT name,slug FROM orgs WHERE published=1 ORDER BY name')}));
  app.get('/api/demo-scenarios',(_req,res)=>{
    if(!demo) return invalid(res,'ไม่มีหน้าตัวอย่างในโหมดจริง',404);
    const scenarios=rowSet(db,`SELECT o.slug,o.name AS organization,d.bank_reference AS bankReference,d.kind,d.label,d.theme,j.amount,
      CASE WHEN c.journal_id IS NULL THEN 0 ELSE 1 END AS claimed
      FROM demo_scenarios d JOIN orgs o ON o.id=d.org_id AND o.published=1
      JOIN journals j ON j.id=d.journal_id LEFT JOIN donation_claims c ON c.journal_id=j.id
      ORDER BY o.name,d.bank_reference`).map(row=>({...row,claimed:Boolean(row.claimed),synthetic:true,published:true}));
    res.json({scenarios,notice:'กรณีทดสอบสมมติ ไม่ใช่ข้อมูลธนาคารจริง'});
  });
  app.get('/api/demo-scenarios/:slug/:bankReference',(req,res)=>{
    if(!demo) return invalid(res,'ไม่มีหน้าตัวอย่างในโหมดจริง',404);
    const row=db.prepare(`SELECT j.id,j.org_id,j.reference,j.amount,j.posted_at,o.name AS organization
      FROM demo_scenarios d JOIN orgs o ON o.id=d.org_id AND o.published=1 JOIN journals j ON j.id=d.journal_id
      WHERE o.slug=? AND d.bank_reference=?`).get(req.params.slug,req.params.bankReference);
    if(!row) return invalid(res,'ไม่พบตัวอย่าง',404);
    res.json({...trackingForDonation(db,row),demoPreview:true,notice:'ตัวอย่างสมมติสำหรับสำรวจ ไม่ใช่การยืนยันการบริจาคของผู้ใช้'});
  });
  app.get('/api/public/:slug',(req,res)=>{
    const org=db.prepare('SELECT * FROM orgs WHERE slug=? AND published=1').get(req.params.slug);if(!org)return invalid(res,'ไม่พบหน้าสาธารณะ',404);
    const sums=db.prepare("SELECT COALESCE(SUM(CASE WHEN kind='donation' THEN amount ELSE 0 END),0) AS income,COALESCE(SUM(CASE WHEN kind='expense' THEN amount ELSE 0 END),0) AS expenses FROM journals WHERE org_id=?").get(org.id);
    const donations=[]; // Never enumerate transfer-derived references: that would let visitors hijack a one-time donor claim.
    res.json({organization:org.name,slug:org.slug,summary:sums,donations,notice:'ข้อมูลจำลองสำหรับสาธิต ไม่ใช่งบที่ผู้สอบบัญชีรับรอง'});
  });
  app.get('/api/public/:slug/proof/:reference',(req,res)=>{
    const org=db.prepare('SELECT id FROM orgs WHERE slug=? AND published=1').get(req.params.slug);if(!org)return invalid(res,'ไม่พบหน้า',404);
    const j=db.prepare("SELECT * FROM journals WHERE org_id=? AND reference=? AND kind='donation'").get(org.id,req.params.reference);if(!j)return invalid(res,'ไม่พบเลขอ้างอิง',404);
    const item=db.prepare('SELECT i.*,b.root,b.status,b.tx_hash,b.chain_id FROM batch_items i JOIN batches b ON b.id=i.batch_id WHERE i.journal_id=?').get(j.id);
    res.json({reference:j.reference,amount:j.amount,postedAt:j.posted_at,record:{id:j.id,org_id:j.org_id,kind:j.kind,amount:j.amount,reference:j.reference,evidence_hash:null,posted_at:j.posted_at},proof:item?{batchId:item.batch_id,root:item.root,leaf:item.leaf_hash,path:JSON.parse(item.proof_json),status:item.status,txHash:item.tx_hash,chainId:item.chain_id,valid:verifyProof(leafHash(j),JSON.parse(item.proof_json),item.root)}:null});
  });
  app.use('/api',(req,res)=>invalid(res,'ไม่พบ API',404));
  const dist=resolve('./dist'); if(existsSync(dist)){app.use(express.static(dist,{index:false,maxAge:'1h'}));app.get(/.*/,(req,res)=>res.sendFile(resolve(dist,'index.html')));}
  app.use((err,req,res,_next)=>{ console.error('request error',err); if(res.headersSent)return;invalid(res,err.type==='entity.too.large'?'ข้อมูลใหญ่เกินไป':'คำขอไม่สำเร็จ',err.type==='entity.too.large'?413:500); });
  return app;
}

