import React, { useEffect, useState } from 'react';
import './foundation-directory.css';

export function FoundationDirectory({api,currentSlug,onSelect}) {
 const [organizations,setOrganizations]=useState([]);
 const [query,setQuery]=useState('');
 const [error,setError]=useState('');
 useEffect(()=>{let active=true;api('/public-organizations').then(result=>{if(active)setOrganizations(result.organizations)}).catch(err=>{if(active)setError(err.message)});return()=>{active=false}},[api]);
 const filtered=organizations.filter(org=>org.name.toLocaleLowerCase('th').includes(query.trim().toLocaleLowerCase('th')));
 return <section className="section foundation-directory" aria-label="เลือกมูลนิธิ"><div className="foundation-directory-heading"><div><span className="eyebrow">หลายมูลนิธิ · แยกข้อมูลจากกัน</span><h2>เลือกมูลนิธิ</h2><p>เลือกองค์กรที่ต้องการดูยอดรวม หรือค้นหาชื่อก่อน ทั้งหมดเป็นข้อมูลตัวอย่างในโหมดสาธิต</p></div><span className="foundation-count">{organizations.length} แห่ง</span></div>
 <label className="foundation-search">ค้นหามูลนิธิ<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="ค้นหาชื่อมูลนิธิ" /></label>
 {error&&<p role="alert">{error}</p>}
 <div className="foundation-grid">{filtered.map(org=><article className={'foundation-card '+(org.slug===currentSlug?'selected':'')} key={org.slug}><span>{org.name}</span><button type="button" className="button secondary" onClick={()=>onSelect(org.slug)} aria-label={`ดูข้อมูล ${org.name}`} aria-pressed={org.slug===currentSlug}>ดูข้อมูล</button></article>)}</div>
 {!filtered.length&&organizations.length>0&&<p>ไม่พบมูลนิธิที่ตรงกับคำค้น</p>}</section>;
}
