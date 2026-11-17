import React, { useEffect, useState } from 'react';
import './tracking.css';

function bahtToSatang(value) {
  if (!/^\d{1,9}(?:\.\d{1,2})?$/.test(value.trim())) throw Error('กรอกจำนวนเงินเป็นบาท เช่น 100 หรือ 100.50');
  const [whole, fraction=''] = value.trim().split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2,'0'));
}
export function Tracking({ api, thb, date, demo, slug='saengmai' }) {
  const [bankReference,setBankReference] = useState('');
  const [amount,setAmount] = useState('');
  const [token,setToken] = useState(() => localStorage.getItem('rt_donor_tracking') || '');
  const [entry,setEntry] = useState(null);
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const [org,setOrg] = useState(slug);
  const [orgs,setOrgs] = useState([]);
  const [cases,setCases] = useState([]);
  const [demoPreview,setDemoPreview] = useState(false);
  useEffect(() => { setOrg(slug); },[slug]);
  useEffect(() => { api('/public-organizations').then(result => setOrgs(result.organizations)).catch(() => setOrgs([])); },[api]);
  useEffect(() => { if(demo) api('/demo-scenarios').then(result => setCases(result.scenarios)).catch(() => setCases([])); },[api,demo]);
  async function previewCase(sample) {
    setBusy(true);setError('');
    try { const result=await api(`/demo-scenarios/${encodeURIComponent(sample.slug)}/${encodeURIComponent(sample.bankReference)}`);setEntry(result);setDemoPreview(true);setBankReference(sample.bankReference);setAmount(String(sample.amount/100)); }
    catch(e){setError(e.message)} finally{setBusy(false)}
  }
  async function lookup(value) {
    setBusy(true);setError('');
    try { setEntry(await api('/tracking',{method:'POST',body:JSON.stringify({token:value.trim()})}));setDemoPreview(false); }
    catch(e) { setEntry(null);setError(e.message); }
    finally { setBusy(false); }
  }
  async function claim(event) {
    event.preventDefault();setBusy(true);setError('');
    try {
      const response=await api(`/public/${encodeURIComponent(org.trim())}/claim`,{method:'POST',body:JSON.stringify({bankReference:bankReference.trim(),amount:bahtToSatang(amount)})});
      setToken(response.token);localStorage.setItem('rt_donor_tracking',response.token);
      setEntry(await api('/tracking',{method:'POST',body:JSON.stringify({token:response.token})}));setDemoPreview(false);
    } catch(e) { setError(e.message); } finally { setBusy(false); }
  }
  return <div className="tracking-page">
    <div className="tracking-heading"><span className="eyebrow">สำหรับผู้บริจาค · ไม่ต้องเข้าสู่ระบบ</span><h1>ติดตามเงินที่ฉันบริจาค</h1><p>กรอกเลขธุรกรรมจากสลิปและยอดเงิน ระบบจะตรวจเทียบกับรายการเงินเข้าที่มูลนิธิบันทึกจากธนาคาร ก่อนออก <b>รหัสติดตามของรู้ทัน</b></p></div>
    <div className="tracking-steps"><div><b>1. โอน</b><span>เงินบาทเข้าบัญชีมูลนิธิโดยตรง</span></div><div><b>2. ยืนยัน</b><span>ใช้เลขธุรกรรมบนสลิปเทียบเงินเข้า</span></div><div><b>3. ติดตาม</b><span>ดูกองทุนที่จัดสรรและความคืบหน้า</span></div></div>
    <section className="section tracking-choice"><label>มูลนิธิที่คุณโอนให้<select required value={org} onChange={e=>{setOrg(e.target.value);setEntry(null);setDemoPreview(false);history.replaceState({},'',`/track/${encodeURIComponent(e.target.value)}`)}}><option value="">เลือกมูลนิธิ</option>{orgs.map(item=><option key={item.slug} value={item.slug}>{item.name}</option>)}</select></label></section>
    {demo && <section className="section demo-cases"><div className="demo-cases-header"><div><span className="eyebrow">ทดลองได้โดยไม่ใช้สิทธิ์รับรหัส</span><h2>เคสตัวอย่างสำหรับลองดู</h2><p>เลือกมูลนิธิด้านบน แล้วเปิดดูตัวอย่างหลายสถานะได้ซ้ำ ข้อมูลทั้งหมดสมมติ การกดดูตัวอย่างไม่ใช่การยืนยันว่าเงินของคุณเข้าจริง</p></div><span>{cases.filter(item=>item.slug===org).length} เคส</span></div><div className="demo-case-grid">{cases.filter(item=>item.slug===org).map(item=><article className="demo-case" key={`${item.slug}-${item.bankReference}`}><strong>{item.label}</strong><span>{item.theme} · {thb(item.amount)}</span><small>รายการทดสอบ {item.bankReference}{item.claimed?' · มีผู้รับรหัสแล้ว':''}</small><button type="button" className="button secondary" disabled={busy} onClick={()=>previewCase(item)}>ดูตัวอย่าง</button></article>)}</div></section>}
    <div className="tracking-columns"><section className="section tracking-card"><h2>เพิ่งโอนเงิน</h2><p>ไม่ต้องกรอกชื่อ–นามสกุลหรือเลขบัญชี กรุณาอย่าเผยแพร่สลิปในที่สาธารณะ</p><form onSubmit={claim}>
      <label>เลขธุรกรรมจากสลิป<input required value={bankReference} onChange={e=>setBankReference(e.target.value)} placeholder="เช่น DEMO-IN-002 (ข้อมูลทดลอง)" autoComplete="off" /></label>
      <label>ยอดที่โอน (บาท)<input required inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="เช่น 100" /></label>
      <button className="button primary" disabled={busy}>{busy?'กำลังตรวจสอบ…':'ยืนยันกับรายการเงินเข้า'}</button>
    </form></section><section className="section tracking-card"><h2>เคยรับรหัสแล้ว</h2><p>ใส่รหัสติดตามที่ได้รับ เพื่อดูสถานะล่าสุด รหัสนี้ควรเก็บเป็นส่วนตัว</p><form onSubmit={event=>{event.preventDefault();lookup(token)}}><label>รหัสติดตาม<input required value={token} onChange={e=>setToken(e.target.value)} placeholder="วางรหัสติดตามที่ได้รับ" autoComplete="off" /></label><button className="button secondary" disabled={busy}>ดูความคืบหน้า</button></form>{token&&<button className="text-link" onClick={()=>{localStorage.removeItem('rt_donor_tracking');setToken('');setEntry(null)}}>ล้างรหัสที่เก็บในเครื่องนี้</button>}</section></div>
    {error&&<div className="alert error" role="alert">{error}{error.includes('ยืนยันรายการนี้')&&<span> หากเพิ่งโอน ธนาคารอาจยังไม่ส่งข้อมูลเข้าระบบ หรือมูลนิธิยังไม่เชื่อมข้อมูลธนาคารจริง</span>}</div>}
    {entry&&<section className="section tracking-result" aria-live="polite"><span className="eyebrow">{demoPreview?'ตัวอย่างจำลอง ไม่ใช่เงินของคุณ':'ผลการติดตามรายการของคุณ'}</span><h2>{entry.donation.organization}</h2><p>{demoPreview?'รายการเงินบริจาคตัวอย่าง':'พบเงินบริจาค'} <strong>{thb(entry.donation.amount)}</strong> · {date(entry.donation.postedAt)} · เลขรายการ {entry.donation.reference}</p>
      <div className="tracking-status"><div><b>{demoPreview?'ข้อมูลทดลองในระบบ':'รับเข้าระบบแล้ว'}</b><span>{demoPreview?'ไม่ได้เชื่อมธนาคารจริง':'ตรงกับรายการธนาคารที่มูลนิธิบันทึก'}</span></div><div><b>คงเหลือรอจัดสรร: {thb(entry.unallocated)}</b><span>{entry.unallocated>0?'รอมูลนิธิระบุโครงการ':'จัดสรรครบตามข้อมูลในระบบ'}</span></div></div>
      {entry.allocations.length?<div><h3>จัดสรรไปยังกองทุน/โครงการ</h3>{entry.allocations.map(item=><div className="tracking-allocation" key={item.purpose}><div><strong>{item.purpose}</strong><span>รายจ่ายรวมที่บันทึกและอนุมัติในโครงการ: {thb(item.programExpenses)} ({item.programExpenseCount} รายการ)</span></div><b>{thb(item.amount)} จากเงินบริจาคนี้</b></div>)}</div>:<p className="tracking-wait">ยังไม่มีการจัดสรร อย่าเพิ่งสรุปว่าเงินนี้ถูกใช้กับโครงการใด</p>}
      <p className="tracking-disclaimer">{entry.explanation} รายจ่ายที่แสดงเป็นข้อมูลรวม ไม่ใช่หลักฐานว่าเงินของคุณจ่ายรายการนั้นโดยตรง และไฟล์ใบเสร็จส่วนตัวไม่เปิดสาธารณะ{demoPreview?' · รายจ่ายตัวอย่างนี้ไม่มีไฟล์หลักฐานจริง':''}</p>{!demoPreview&&<div className="tracking-secret"><span>เก็บรหัสติดตามไว้สำหรับกลับมาดูอีก</span><code>{token}</code><button className="button secondary" onClick={()=>navigator.clipboard.writeText(token).catch(()=>setError('คัดลอกไม่สำเร็จ กรุณาคัดลอกรหัสด้วยตัวเอง'))}>คัดลอกรหัส</button></div>}</section>}
  </div>;
}
export function Allocations({data,api,run,thb}) {
  const [reference,setReference]=useState(''),[purpose,setPurpose]=useState(''),[amount,setAmount]=useState('');
  const donations=data?.donations||[];
  const selected=donations.find(item=>item.reference===reference);
  return <div className="tracking-page"><div className="tracking-heading"><span className="eyebrow">สำหรับเจ้าหน้าที่</span><h1>จัดสรรเงินบริจาค</h1><p>เลือกรายการรับบริจาคที่บันทึกจากธนาคาร แล้วระบุโครงการ เงินที่ยังไม่จัดสรรจะแสดงตามจริงบนหน้าผู้บริจาค</p></div><section className="section tracking-card"><h2>บันทึกการจัดสรร</h2><form onSubmit={event=>{event.preventDefault();run(async()=>{await api('/allocations',{method:'POST',body:JSON.stringify({donationReference:reference,purpose,amount:bahtToSatang(amount)})});setAmount('')},'บันทึกการจัดสรรแล้ว')}}><label>รายการรับบริจาค<select value={reference} onChange={e=>setReference(e.target.value)} required><option value="">เลือกรายการ</option>{donations.filter(item=>item.amount>item.allocated).map(item=><option key={item.reference} value={item.reference}>{item.reference} · เหลือ {thb(item.amount-item.allocated)}</option>)}</select></label><label>ชื่อโครงการ/กองทุน<input required list="known-purposes" value={purpose} onChange={e=>setPurpose(e.target.value)} placeholder="เช่น โครงการอาหารกลางวัน" /></label><datalist id="known-purposes">{data?.purposes?.map(value=><option key={value} value={value}/>)}</datalist><label>จำนวนเงินที่จัดสรร (บาท)<input required inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="เช่น 100" /></label><p>รายจ่ายรวมจะจับคู่กับ <b>ชื่อวัตถุประสงค์ของรายจ่ายที่ตรงกัน</b> เท่านั้น กรุณาตรวจชื่อก่อนบันทึก</p><button className="button primary">บันทึกการจัดสรร</button></form>{selected&&<p>รายการนี้ยังจัดสรรได้ {thb(selected.amount-selected.allocated)}</p>}</section></div>;
}
