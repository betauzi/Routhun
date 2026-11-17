import { randomBytes } from 'node:crypto';
import { audit, id, now } from './db.mjs';
import { sha256 } from './crypto.mjs';

// Shared read model: token lookup and clearly labeled demo previews have identical allocation math.
export function trackingForDonation(db, donation) {
  const allocations = db.prepare('SELECT purpose,SUM(amount) AS amount FROM donation_allocations WHERE journal_id=? GROUP BY purpose ORDER BY purpose').all(donation.id);
  for (const allocation of allocations) {
    const expense = db.prepare("SELECT COALESCE(SUM(amount),0) AS amount,COUNT(*) AS count FROM expenses WHERE org_id=? AND status='approved' AND purpose=?").get(donation.org_id, allocation.purpose);
    allocation.programExpenses = expense.amount;
    allocation.programExpenseCount = expense.count;
  }
  const allocated = allocations.reduce((sum, item) => sum + item.amount, 0);
  return { donation: { reference: donation.reference, amount: donation.amount, postedAt: donation.posted_at, organization: donation.organization },
    allocations, unallocated: donation.amount - allocated,
    explanation: 'การจัดสรรคือส่วนร่วมในกองทุน ไม่ใช่หลักฐานว่าธนบัตรของคุณจ่ายใบเสร็จใดโดยเฉพาะ; ยอดรายจ่ายเป็นยอดรวมของโครงการ' };
}

// A slip reference is a lookup hint, never proof by itself. Only pre-existing,
// matched incoming bank records can receive a tracking token.
export function registerTracking(app, { db, auth, only, transaction, invalid }) {
  const attempts = new Map();
  function limited(req, res, next) {
    const at = Date.now(), key = req.ip;
    const recent = (attempts.get(key) || []).filter(time => at - time < 60000);
    if (recent.length >= 10) return invalid(res, 'ลองใหม่ในอีกหนึ่งนาที', 429);
    recent.push(at); attempts.set(key, recent);
    if (attempts.size > 5000) attempts.clear();
    next();
  }
  app.post('/api/public/:slug/claim', limited, (req, res) => {
    const bankReference = typeof req.body.bankReference === 'string' ? req.body.bankReference.trim() : '';
    const amount = Number(req.body.amount);
    if (!bankReference || bankReference.length > 120 || !Number.isSafeInteger(amount) || amount <= 0) return invalid(res, 'ระบุเลขธุรกรรมบนสลิปและยอดเงิน');
    const row = db.prepare(`SELECT j.id,j.org_id FROM orgs o JOIN bank_transactions b ON b.org_id=o.id
      JOIN journals j ON j.id=b.matched_journal_id AND j.org_id=o.id
      WHERE o.slug=? AND o.published=1 AND b.reference=? AND b.direction='in' AND b.amount=? AND j.kind='donation'`).get(req.params.slug, bankReference, amount);
    if (!row) return invalid(res, 'ยังยืนยันรายการนี้กับข้อมูลธนาคารไม่ได้', 404);
    const token = randomBytes(32).toString('base64url');
    try {
      transaction(() => {
        db.prepare('INSERT INTO donation_claims VALUES (?,?,?,?)').run(row.id, row.org_id, sha256(token), now());
        audit(db, row.org_id, null, 'donation.claim', row.id, { claimed: true });
      });
    } catch (error) {
      if (String(error.message).includes('UNIQUE')) return invalid(res, 'รายการนี้มีรหัสติดตามแล้ว ติดต่อมูลนิธิหากทำรหัสหาย', 409);
      throw error;
    }
    res.status(201).json({ token, message: 'เก็บรหัสนี้ไว้ในที่ปลอดภัย ระบบไม่แสดงซ้ำ' });
  });
  app.post('/api/tracking', limited, (req, res) => {
    const token = req.body.token;
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return invalid(res, 'ไม่พบรหัสติดตาม', 404);
    const donation = db.prepare(`SELECT j.id,j.org_id,j.reference,j.amount,j.posted_at,o.name AS organization
      FROM donation_claims c JOIN journals j ON j.id=c.journal_id
      JOIN orgs o ON o.id=c.org_id AND o.published=1 WHERE c.token_hash=?`).get(sha256(token));
    if (!donation) return invalid(res, 'ไม่พบรหัสติดตาม', 404);
    res.json(trackingForDonation(db, donation));
  });
  app.get('/api/allocations', auth, only('staff','admin'), (req, res) => {
    const donations = db.prepare(`SELECT j.reference,j.title,j.amount,
      COALESCE((SELECT SUM(a.amount) FROM donation_allocations a WHERE a.journal_id=j.id),0) AS allocated
      FROM journals j WHERE j.org_id=? AND j.kind='donation' ORDER BY j.posted_at DESC`).all(req.user.org_id);
    res.json({ donations, purposes: db.prepare('SELECT DISTINCT purpose FROM expenses WHERE org_id=? ORDER BY purpose').all(req.user.org_id).map(row => row.purpose) });
  });
  app.post('/api/allocations', auth, only('staff','admin'), (req, res) => {
    const reference = typeof req.body.donationReference === 'string' ? req.body.donationReference.trim() : '';
    const purpose = typeof req.body.purpose === 'string' ? req.body.purpose.trim().slice(0,120) : '';
    const amount = Number(req.body.amount);
    if (!reference || !purpose || !Number.isSafeInteger(amount) || amount <= 0) return invalid(res, 'ระบุรายการรับบริจาค โครงการ และยอดจัดสรร');
    let allocationId;
    try {
      transaction(() => {
        const donation = db.prepare("SELECT * FROM journals WHERE org_id=? AND reference=? AND kind='donation' AND bank_id IS NOT NULL").get(req.user.org_id, reference);
        if (!donation) throw new Error('DONATION_NOT_FOUND');
        const allocated = db.prepare('SELECT COALESCE(SUM(amount),0) AS total FROM donation_allocations WHERE journal_id=?').get(donation.id).total;
        if (allocated + amount > donation.amount) throw new Error('OVER_ALLOCATED');
        allocationId = id();
        db.prepare('INSERT INTO donation_allocations VALUES (?,?,?,?,?,?,?)').run(allocationId, donation.id, req.user.org_id, purpose, amount, now(), req.user.id);
        audit(db, req.user.org_id, req.user.id, 'donation.allocate', donation.id, { purpose, amount, allocationId });
      });
    } catch (error) {
      if (error.message === 'DONATION_NOT_FOUND') return invalid(res, 'ไม่พบเงินบริจาคที่ยืนยันแล้ว', 404);
      if (error.message === 'OVER_ALLOCATED') return invalid(res, 'ยอดจัดสรรเกินเงินบริจาคที่เหลือ');
      throw error;
    }
    res.status(201).json({ id: allocationId, purpose, amount });
  });
}
