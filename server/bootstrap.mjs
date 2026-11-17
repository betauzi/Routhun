import { openDatabase, id, now, passwordHash } from './db.mjs';
const {ADMIN_EMAIL,ADMIN_PASSWORD,ORG_NAME,ORG_SLUG}=process.env;
if(!ADMIN_EMAIL||!ADMIN_PASSWORD||ADMIN_PASSWORD.length<14||!ORG_NAME||!ORG_SLUG||!/^[a-z0-9-]{3,50}$/.test(ORG_SLUG)){
 console.error('Set ADMIN_EMAIL, ADMIN_PASSWORD (14+ chars), ORG_NAME, ORG_SLUG (lowercase ASCII). Do not use demo credentials.');process.exit(2);
}
const db=openDatabase();
if(db.prepare('SELECT 1 FROM users WHERE email=?').get(ADMIN_EMAIL.toLowerCase())||db.prepare('SELECT 1 FROM orgs WHERE slug=?').get(ORG_SLUG)) {console.error('Account or organization already exists');process.exit(1)}
const orgId=id();db.exec('BEGIN IMMEDIATE');try{
 db.prepare('INSERT INTO orgs VALUES (?,?,?,?,?)').run(orgId,ORG_NAME,ORG_SLUG,0,now());
 db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,1)').run(id(),orgId,ADMIN_EMAIL.toLowerCase(),'ผู้ดูแลระบบ','admin',passwordHash(ADMIN_PASSWORD));
 db.exec('COMMIT');console.log(`Created unpublished organization ${ORG_SLUG} and admin account.`);
}catch(e){db.exec('ROLLBACK');throw e}
