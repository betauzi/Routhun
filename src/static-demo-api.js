// This is a public, read-only showcase: sessionStorage is UI state, not authentication.
import { canVisit } from './roles.js';

const KEY = 'rt_static_demo_account';
const PASSWORD = 'RouthunDemo2027!';
const routePages = {
  '/dashboard':'overview', '/ledger':'ledger', '/bank':'bank', '/allocations':'allocations',
  '/expenses':'expenses', '/anchors':'proof', '/reports':'reports', '/audit':'audit', '/team':'team'
};

export function createStaticDemoApi(snapshot,{storage}={}) {
  const store=storage || (typeof sessionStorage !== 'undefined' ? sessionStorage : null);
  const current=()=>snapshot.accounts.find(u=>u.email===store?.getItem(KEY)) || null;
  return async function api(path,options={}) {
    const method=(options.method||'GET').toUpperCase();
    if (path==='/me' && method==='GET') return {user:current(),demo:true};
    if (path==='/demo-accounts' && method==='GET') return {accounts:snapshot.accounts.map(({email,name,role})=>({email,name,role})),password:PASSWORD};
    if (path==='/auth/login' && method==='POST') {
      let credentials={};try {credentials=JSON.parse(options.body||'{}');}catch { /* invalid input */ }
      const user=snapshot.accounts.find(u=>u.email===String(credentials.email||'').trim().toLowerCase());
      if (!user || credentials.password!==PASSWORD) throw Error('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
      store?.setItem(KEY,user.email);
      return {user};
    }
    if (path==='/auth/logout' && method==='POST') {store?.removeItem(KEY);return {ok:true};}
    if (method!=='GET') throw Error('เดโมออนไลน์นี้อ่านอย่างเดียว ไม่บันทึกข้อมูลหรือยืนยันการบริจาคจริง');
    if (Object.hasOwn(snapshot.public,path)) return structuredClone(snapshot.public[path]);
    const user=current();
    if (!user) throw Error('กรุณาเข้าสู่ระบบ');
    const page=routePages[path] || (path.startsWith('/proof/')?'proof':null);
    if (page&&!canVisit(user.role,page)) throw Error('ไม่มีสิทธิ์ดูหน้านี้ในบทบาทตัวอย่าง');
    const result=snapshot.roles[user.role]?.[path];
    if (result===undefined) throw Error('ไม่พบข้อมูลตัวอย่างสำหรับรายการนี้');
    return structuredClone(result);
  };
}

let loading;
export async function staticDemoApi(path,options) {
  if (!loading) loading=fetch('/demo-data.json').then(async response=>{
    if (!response.ok) throw Error('โหลดข้อมูลเดโมไม่สำเร็จ');
    return createStaticDemoApi(await response.json());
  }).catch(error=>{loading=null;throw error});
  return (await loading)(path,options);
}
