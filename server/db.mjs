import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { sha256, stable } from './crypto.mjs';
import { seedCaseFoundations } from './demo-cases.mjs';

export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export function passwordHash(password, salt = randomBytes(16).toString('hex')) { return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`; }
export function passwordValid(password, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  try { return timingSafeEqual(Buffer.from(hash, 'hex'), scryptSync(password, salt, 64)); } catch { return false; }
}

export function openDatabase(path = process.env.DB_PATH || './data/routhun.db') {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS orgs (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, published INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES orgs(id), email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('staff','board','auditor','admin')), password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS bank_transactions (id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES orgs(id), direction TEXT NOT NULL CHECK(direction IN ('in','out')), amount INTEGER NOT NULL CHECK(amount>0), description TEXT NOT NULL, happened_at TEXT NOT NULL, reference TEXT, matched_journal_id TEXT, UNIQUE(org_id,reference));
    CREATE TABLE IF NOT EXISTS evidence (id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES orgs(id), name TEXT NOT NULL, mime TEXT NOT NULL, content_hash TEXT NOT NULL, ciphertext BLOB NOT NULL, iv BLOB NOT NULL, tag BLOB NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS expenses (id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES orgs(id), title TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>0), purpose TEXT NOT NULL, evidence_id TEXT REFERENCES evidence(id), evidence_name TEXT, evidence_hash TEXT, bank_id TEXT, created_by TEXT NOT NULL REFERENCES users(id), status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')), created_at TEXT NOT NULL, journal_id TEXT);
    CREATE TABLE IF NOT EXISTS approvals (id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES orgs(id), expense_id TEXT NOT NULL REFERENCES expenses(id), user_id TEXT NOT NULL REFERENCES users(id), decision TEXT NOT NULL CHECK(decision IN ('approve','reject')), statement_hash TEXT NOT NULL, at TEXT NOT NULL, UNIQUE(expense_id,user_id));
    CREATE TABLE IF NOT EXISTS journals (id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES orgs(id), kind TEXT NOT NULL CHECK(kind IN ('donation','expense')), amount INTEGER NOT NULL, reference TEXT NOT NULL UNIQUE, evidence_hash TEXT, posted_at TEXT NOT NULL, bank_id TEXT, title TEXT NOT NULL, batch_id TEXT);
    CREATE TABLE IF NOT EXISTS ledger_entries (id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES orgs(id), journal_id TEXT NOT NULL REFERENCES journals(id), account TEXT NOT NULL, debit INTEGER NOT NULL DEFAULT 0, credit INTEGER NOT NULL DEFAULT 0, CHECK(debit>=0 AND credit>=0 AND debit+credit>0));
    CREATE TABLE IF NOT EXISTS audit_events (id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES orgs(id), actor_id TEXT, action TEXT NOT NULL, target TEXT NOT NULL, at TEXT NOT NULL, payload_hash TEXT NOT NULL, prev_hash TEXT, hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS batches (id TEXT PRIMARY KEY, root TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('local','submitted','confirmed','failed')), chain_id INTEGER, tx_hash TEXT, block_number TEXT, error TEXT);
    CREATE TABLE IF NOT EXISTS batch_items (batch_id TEXT NOT NULL REFERENCES batches(id), journal_id TEXT NOT NULL UNIQUE REFERENCES journals(id), leaf_hash TEXT NOT NULL, proof_json TEXT NOT NULL, PRIMARY KEY(batch_id,journal_id));
    CREATE TABLE IF NOT EXISTS donation_claims (journal_id TEXT PRIMARY KEY REFERENCES journals(id), org_id TEXT NOT NULL REFERENCES orgs(id), token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS donation_allocations (id TEXT PRIMARY KEY, journal_id TEXT NOT NULL REFERENCES journals(id), org_id TEXT NOT NULL REFERENCES orgs(id), purpose TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>0), created_at TEXT NOT NULL, actor_id TEXT NOT NULL REFERENCES users(id));
    CREATE TABLE IF NOT EXISTS demo_scenarios (org_id TEXT NOT NULL REFERENCES orgs(id), bank_reference TEXT NOT NULL, journal_id TEXT NOT NULL UNIQUE REFERENCES journals(id), kind TEXT NOT NULL, label TEXT NOT NULL, theme TEXT NOT NULL, PRIMARY KEY(org_id,bank_reference));
    CREATE INDEX IF NOT EXISTS idx_allocations_journal ON donation_allocations(journal_id);
    CREATE INDEX IF NOT EXISTS idx_journals_org ON journals(org_id,posted_at);
    CREATE INDEX IF NOT EXISTS idx_expenses_org ON expenses(org_id,status);
    CREATE INDEX IF NOT EXISTS idx_bank_org ON bank_transactions(org_id,happened_at);
    CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_events(org_id,at);
    CREATE TRIGGER IF NOT EXISTS journal_no_update BEFORE UPDATE ON journals BEGIN SELECT RAISE(ABORT,'Journal immutable'); END;
    CREATE TRIGGER IF NOT EXISTS journal_no_delete BEFORE DELETE ON journals BEGIN SELECT RAISE(ABORT,'Journal immutable'); END;
    CREATE TRIGGER IF NOT EXISTS ledger_no_update BEFORE UPDATE ON ledger_entries BEGIN SELECT RAISE(ABORT,'Ledger immutable'); END;
    CREATE TRIGGER IF NOT EXISTS ledger_no_delete BEFORE DELETE ON ledger_entries BEGIN SELECT RAISE(ABORT,'Ledger immutable'); END;
    CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT,'Audit immutable'); END;
    CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT,'Audit immutable'); END;
  `);
  return db;
}
export function audit(db, orgId, actorId, action, target, payload) {
  const prev = db.prepare('SELECT hash FROM audit_events WHERE org_id=? ORDER BY rowid DESC LIMIT 1').get(orgId)?.hash || null;
  const row = { id: id(), orgId, actorId, action, target, at: now(), payloadHash: sha256(stable(payload)), prev };
  const hash = sha256(`routhun:audit:v1:${stable(row)}`);
  db.prepare('INSERT INTO audit_events VALUES (?,?,?,?,?,?,?,?,?)').run(row.id,orgId,actorId,action,target,row.at,row.payloadHash,prev,hash);
  return hash;
}
export function postJournal(db, { orgId, kind, amount, reference, evidenceHash = null, bankId = null, title, at = now() }) {
  const journalId = id();
  db.prepare('INSERT INTO journals (id,org_id,kind,amount,reference,evidence_hash,posted_at,bank_id,title) VALUES (?,?,?,?,?,?,?,?,?)').run(journalId,orgId,kind,amount,reference,evidenceHash,at,bankId,title);
  const entries = kind === 'donation' ? [['Cash',amount,0],['Donation income',0,amount]] : [['Program expense',amount,0],['Cash',0,amount]];
  for (const [account,debit,credit] of entries) db.prepare('INSERT INTO ledger_entries VALUES (?,?,?,?,?,?)').run(id(),orgId,journalId,account,debit,credit);
  if (bankId) db.prepare('UPDATE bank_transactions SET matched_journal_id=? WHERE id=? AND org_id=?').run(journalId,bankId,orgId);
  return journalId;
}
export function seedDemo(db) {
  const tools={id,now,passwordHash,postJournal,audit};
  if (db.prepare('SELECT COUNT(*) AS count FROM orgs').get().count) return seedCaseFoundations(db,tools);
  const org = id(), timestamp = now();
  db.prepare('INSERT INTO orgs VALUES (?,?,?,?,?)').run(org,'มูลนิธิแสงใหม่','saengmai',1,timestamp);
  const roles = [
    ['admin@demo.routhun.test','ผู้ดูแลระบบ','admin'], ['staff@demo.routhun.test','เจ้าหน้าที่การเงิน','staff'],
    ['board1@demo.routhun.test','กรรมการคนที่หนึ่ง','board'], ['board2@demo.routhun.test','กรรมการคนที่สอง','board'],
    ['auditor@demo.routhun.test','ผู้สอบบัญชีตัวอย่าง','auditor']
  ];
  const userIds = {};
  for (const [email,name,role] of roles) { const uid=id(); userIds[role === 'board' ? email : role]=uid; db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,1)').run(uid,org,email,name,role,passwordHash('RouthunDemo2027!')); }
  const banks = [
    ['in',125000,'บริจาคโครงการอาหารกลางวัน','DEMO-IN-001'],['in',50000,'บริจาคทั่วไป','DEMO-IN-002'],['in',240000,'สนับสนุนทุนการศึกษา','DEMO-IN-003'],
    ['out',32000,'ร้านเครื่องเขียนตัวอย่าง','DEMO-OUT-001'],['out',18500,'ค่าจัดส่งสิ่งของ','DEMO-OUT-002'],['out',7500,'ค่ายาและเวชภัณฑ์','DEMO-OUT-003']
  ];
  for (const [direction,amount,description,reference] of banks) {
    const bankId=id(); db.prepare('INSERT INTO bank_transactions (id,org_id,direction,amount,description,happened_at,reference) VALUES (?,?,?,?,?,?,?)').run(bankId,org,direction,amount,description,timestamp,reference);
    if (direction === 'in') postJournal(db,{orgId:org,kind:'donation',amount,reference:`RT-${reference}`,bankId,title:description,at:timestamp});
    if (reference === 'DEMO-OUT-001') postJournal(db,{orgId:org,kind:'expense',amount,reference:'RT-EXP-DEMO-001',bankId,title:description,at:timestamp,evidenceHash:sha256('demo-receipt-001')});
  }
  const expenseId=id(); db.prepare('INSERT INTO expenses VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(expenseId,org,'ค่าจัดส่งสิ่งของ',18500,'โครงการอาหารกลางวัน',null,'receipt-demo.pdf',sha256('demo-receipt-002'),db.prepare("SELECT id FROM bank_transactions WHERE reference='DEMO-OUT-002'").get().id,userIds.staff,'pending',timestamp,null);
  audit(db,org,userIds.admin,'demo.seed','organization',{ synthetic:true });
  seedCaseFoundations(db,tools);
  return true;
}
