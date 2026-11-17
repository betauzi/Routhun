import { sha256, stable } from './crypto.mjs';

// All names and transactions below are invented. They are never loaded outside DEMO_MODE.
const foundations = [
  ['baan-oon','บ้านอุ่นใจ','ที่พักชั่วคราว','อาหารฉุกเฉิน'],
  ['dek-wan','เด็กวันใหม่','ทุนเรียนรู้','อุปกรณ์นักเรียน'],
  ['rak-talay','รักษ์ทะเล','เก็บขยะชายฝั่ง','ฟื้นฟูปะการัง'],
  ['nam-sai','น้ำใส','ระบบกรองน้ำ','ซ่อมแหล่งน้ำ'],
  ['pa-khiao','ป่าเขียว','ปลูกต้นไม้','ดูแลกล้าไม้'],
  ['arun','อรุณเพื่อผู้สูงวัย','เยี่ยมผู้สูงวัย','อาหารผู้สูงวัย'],
  ['wheel-together','ก้าวด้วยกัน','อุปกรณ์ช่วยเดิน','ปรับพื้นที่เข้าถึง'],
  ['dokmai','ดอกไม้เพื่อผู้ป่วย','พาผู้ป่วยพบแพทย์','ของใช้จำเป็น'],
  ['khao-aun','ข้าวอุ่น','ครัวชุมชน','อาหารเด็ก'],
  ['fon-ma','ฝนมา','ช่วยเหลือน้ำท่วม','ฟื้นฟูบ้าน'],
  ['saen-suk','แสนสุข','สุขภาพจิตชุมชน','กิจกรรมเยาวชน'],
  ['ban-maew','บ้านแมว','ดูแลสัตว์จร','ทำหมันสัตว์'],
  ['tech-dek','เทคโนโลยีเพื่อเด็ก','อุปกรณ์ดิจิทัล','เรียนรู้การเขียนโค้ด'],
  ['su-khao','สู่เขา','ห้องเรียนภูเขา','อุปกรณ์การเรียน'],
  ['rak-ban','รักษ์บ้าน','ซ่อมบ้านผู้เดือดร้อน','งานช่างอาสา'],
  ['ruek-rai','รื่นไร่','เกษตรชุมชน','แหล่งอาหาร'],
  ['tam-kan','ทำกัน','อาชีพใหม่','ฝึกอาชีพ'],
  ['peuan-tang','เพื่อนทาง','รถรับส่งผู้ป่วย','อาสาชุมชน'],
  ['hidden-pilot','โครงการนำร่องที่ยังไม่เผยแพร่','เตรียมข้อมูล','ตรวจสอบภายใน']
];
export const demoFoundationCount = foundations.length;

export function seedCaseFoundations(db, { id, now, passwordHash, postJournal, audit }) {
  const base = db.prepare("SELECT o.id FROM orgs o JOIN users u ON u.org_id=o.id WHERE o.slug='saengmai' AND u.email='admin@demo.routhun.test'").get();
  if (!base) return false; // Do not inject demo tenants into an unrelated existing database.
  let inserted = false;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const [index,[slug,name,theme,secondProject]] of foundations.entries()) {
      if (db.prepare('SELECT id FROM orgs WHERE slug=?').get(slug)) continue;
      inserted = true;
      const orgId=id(), timestamp=now(), published=slug==='hidden-pilot'?0:1;
      db.prepare('INSERT INTO orgs VALUES (?,?,?,?,?)').run(orgId,`มูลนิธิ${name} (สมมติ)`,slug,published,timestamp);
      const members={};
      for (const [role,email] of [['admin',`admin+${slug}@demo.routhun.test`],['board1',`board1+${slug}@demo.routhun.test`],['board2',`board2+${slug}@demo.routhun.test`]]) {
        members[role]=id();
        db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,1)').run(members[role],orgId,email,`บัญชี${role}ตัวอย่าง`,role==='admin'?'admin':'board',passwordHash('RouthunDemo2027!'));
      }
      const donationIds=[];
      for (const [n,amount] of [10000,25000,50000].entries()) {
        const bankReference=`CASE-${slug}-${String(n+1).padStart(3,'0')}`, bankId=id();
        db.prepare('INSERT INTO bank_transactions (id,org_id,direction,amount,description,happened_at,reference) VALUES (?,?,?,?,?,?,?)').run(bankId,orgId,'in',amount,'รายการรับเงินสมมติสำหรับทดลอง',timestamp,bankReference);
        const journalId=postJournal(db,{orgId,kind:'donation',amount,reference:`RT-CASE-${id()}`,bankId,title:'เงินบริจาคตัวอย่าง',at:timestamp});
        donationIds.push(journalId);
        const kind=n===0?['full','partial','unallocated','split','allocated_no_expense','rejected'][index%6] : n===1?'unallocated':'partial';
        const label=n===0?({full:'จัดสรรครบและมีรายจ่ายอนุมัติ',partial:'จัดสรรบางส่วนและรายจ่ายรออนุมัติ',unallocated:'ยังไม่จัดสรร',split:'แบ่งไปสองโครงการ',allocated_no_expense:'จัดสรรครบแต่ยังไม่มีรายจ่าย',rejected:'จัดสรรบางส่วนและรายจ่ายไม่ผ่านอนุมัติ'})[kind]:n===1?'เงินเข้ากองกลาง ยังไม่จัดสรร':'จัดสรรบางส่วน รอการใช้เงิน';
        db.prepare('INSERT INTO demo_scenarios VALUES (?,?,?,?,?,?)').run(orgId,bankReference,journalId,kind,label,theme);
      }
      function allocate(journalId,purpose,amount) {
        db.prepare('INSERT INTO donation_allocations VALUES (?,?,?,?,?,?,?)').run(id(),journalId,orgId,purpose,amount,timestamp,members.admin);
      }
      const kind=index%6;
      if(kind===0||kind===4) allocate(donationIds[0],theme,10000);
      if(kind===1) allocate(donationIds[0],theme,4000);
      if(kind===3){ allocate(donationIds[0],theme,6000);allocate(donationIds[0],secondProject,4000); }
      if(kind===5) allocate(donationIds[0],theme,3500);
      allocate(donationIds[2],secondProject,20000);
      if(kind===0||kind===1||kind===3||kind===5){
        const amount=6000, expenseId=id(), bankId=id(), purpose=kind===3?secondProject:theme, status=kind===0||kind===3?'approved':kind===1?'pending':'rejected';
        db.prepare('INSERT INTO bank_transactions (id,org_id,direction,amount,description,happened_at,reference) VALUES (?,?,?,?,?,?,?)').run(bankId,orgId,'out',amount,'รายจ่ายสมมติ ไม่มีใบเสร็จจริง',timestamp,`CASE-${slug}-OUT`);
        db.prepare('INSERT INTO expenses VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(expenseId,orgId,'รายจ่ายตัวอย่าง (ไม่มีเอกสารจริง)',amount,purpose,null,null,null,bankId,members.admin,status,timestamp,null);
        if(status==='approved'){
          for(const actor of [members.board1,members.board2]){
            const statementHash=sha256(stable({expenseId,amount,evidenceHash:null,bankId,decision:'approve',userId:actor}));
            db.prepare('INSERT INTO approvals VALUES (?,?,?,?,?,?,?)').run(id(),orgId,expenseId,actor,'approve',statementHash,timestamp);
          }
          const journalId=postJournal(db,{orgId,kind:'expense',amount,reference:`RT-EXP-CASE-${id()}`,bankId,title:'รายจ่ายสมมติ (ไม่มีเอกสารจริง)',at:timestamp,evidenceHash:null});
          db.prepare('UPDATE expenses SET journal_id=? WHERE id=?').run(journalId,expenseId);
        }
        if(status==='rejected'){
          const actor=members.board1,statementHash=sha256(stable({expenseId,amount,evidenceHash:null,bankId,decision:'reject',userId:actor}));
          db.prepare('INSERT INTO approvals VALUES (?,?,?,?,?,?,?)').run(id(),orgId,expenseId,actor,'reject',statementHash,timestamp);
        }
      }
      const unmatchedId=id();
      db.prepare('INSERT INTO bank_transactions (id,org_id,direction,amount,description,happened_at,reference) VALUES (?,?,?,?,?,?,?)').run(unmatchedId,orgId,'in',7500,'เงินเข้ารอตรวจสอบ (ยังไม่จับคู่)',timestamp,`CASE-${slug}-UNMATCHED`);
      audit(db,orgId,members.admin,'demo.seed.cases',slug,{synthetic:true,scenarioCount:3});
    }
    for (const [reference,label,theme] of [['DEMO-IN-001','เงินบริจาคระบุโครงการ','โครงการอาหารกลางวัน'],['DEMO-IN-002','เข้ากองกลาง ยังไม่จัดสรร','กองกลาง'],['DEMO-IN-003','ทุนการศึกษา ยังไม่จัดสรร','ทุนการศึกษา']]) {
      const row=db.prepare('SELECT b.matched_journal_id AS journalId FROM bank_transactions b WHERE b.org_id=? AND b.reference=? AND b.matched_journal_id IS NOT NULL').get(base.id,reference);
      if(row && !db.prepare('SELECT 1 FROM demo_scenarios WHERE org_id=? AND bank_reference=?').get(base.id,reference)){
        db.prepare('INSERT INTO demo_scenarios VALUES (?,?,?,?,?,?)').run(base.id,reference,row.journalId,'unallocated',label,theme);inserted=true;
      }
    }
    db.exec('COMMIT');
    return inserted;
  }catch(error){ db.exec('ROLLBACK');throw error; }
}
