import test from 'node:test';
import assert from 'node:assert/strict';
import { createStaticDemoApi } from '../../src/static-demo-api.js';

function fixture() {
  const admin={id:'demo-admin',email:'admin@demo.routhun.test',name:'ผู้ดูแลตัวอย่าง',role:'admin',orgSlug:'saengmai',orgName:'มูลนิธิแสงใหม่'};
  const auditor={...admin,id:'demo-auditor',email:'auditor@demo.routhun.test',role:'auditor'};
  return {accounts:[admin,auditor],public:{'/public-organizations':{organizations:[{name:'มูลนิธิแสงใหม่',slug:'saengmai'}]},'/demo-scenarios/saengmai/DEMO-IN-001':{demoPreview:true,donation:{organization:'มูลนิธิแสงใหม่'},allocations:[]}},roles:{admin:{'/dashboard':{summary:{income:100}}},auditor:{'/dashboard':{summary:{income:100}}}}};
}
function memoryStorage(){const values=new Map();return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};}

test('static demo login switches role, keeps session for reload and never authenticates real users',async()=>{
  const storage=memoryStorage(), api=createStaticDemoApi(fixture(),{storage});
  assert.deepEqual(await api('/me'),{user:null,demo:true});
  await assert.rejects(api('/auth/login',{method:'POST',body:JSON.stringify({email:'admin@demo.routhun.test',password:'wrong'})}),/อีเมลหรือรหัสผ่านไม่ถูกต้อง/);
  const {user}=await api('/auth/login',{method:'POST',body:JSON.stringify({email:'admin@demo.routhun.test',password:'RouthunDemo2027!'})});
  assert.equal(user.role,'admin');
  assert.equal((await api('/dashboard')).summary.income,100);
  assert.equal((await createStaticDemoApi(fixture(),{storage})('/me')).user.role,'admin');
  await api('/auth/logout',{method:'POST'});
  assert.equal((await api('/me')).user,null);
  await assert.rejects(api('/dashboard'),/กรุณาเข้าสู่ระบบ/);
});

test('static demo exposes synthetic previews but blocks all data-changing actions',async()=>{
  const api=createStaticDemoApi(fixture(),{storage:memoryStorage()});
  assert.equal((await api('/demo-scenarios/saengmai/DEMO-IN-001')).demoPreview,true);
  await assert.rejects(api('/public/saengmai/claim',{method:'POST',body:'{}'}),/อ่านอย่างเดียว/);
  await api('/auth/login',{method:'POST',body:JSON.stringify({email:'auditor@demo.routhun.test',password:'RouthunDemo2027!'})});
  await assert.rejects(api('/team'),/ไม่มีสิทธิ์/);
  await assert.rejects(api('/bank',{method:'POST',body:'{}'}),/อ่านอย่างเดียว/);
  await assert.rejects(api('/unknown'),/ไม่พบข้อมูลตัวอย่าง/);
});
