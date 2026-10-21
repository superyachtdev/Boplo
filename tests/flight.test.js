import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {onRequest,validateFlight,validateProfile} from '../functions/flight/[[path]].js';
const valid={date:'2026-01-12',departure:'EGHP',arrival:'EGHP',minutes:65,role:'dual',landings:4,points:[]};
test('flight records reject invalid times, dates, roles and coordinates',()=>{
 for(const changes of [{minutes:-5},{minutes:1.5},{date:'2026-02-30'},{date:'2099-01-01'},{role:'approved'},{points:[{lat:95,lng:0}]},{landings:1.5}])assert.throws(()=>validateFlight({...valid,...changes}));
 assert.equal(validateFlight(valid).minutes,65);
 assert.throws(()=>validateProfile({complete:true}),/Complete/);
 assert.equal(validateProfile({step:2}).complete,false);
});
test('workspace persists profile and flights and prevents cross-account access',async()=>{
 const db=new DatabaseSync(':memory:');
 for(const file of ['0002_darts_product.sql','0009_boplo_flight.sql'])db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const env={DB:{prepare(sql){let args=[];return {bind(...a){args=a;return this;},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){return db.prepare(sql).run(...args);}};}}};
 for(const owner of ['alice','bob']){db.prepare('INSERT INTO darts_users(id,email,created_at,updated_at) VALUES(?,?,0,0)').run(owner,owner+'@example.com');const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(owner)))].map(n=>n.toString(16).padStart(2,'0')).join('');db.prepare('INSERT INTO darts_sessions VALUES(?,?,?,?,?)').run(owner,owner,hash,Date.now()+60000,Date.now());}
 const call=(owner,path,method='GET',body,origin='https://boplo.app')=>onRequest({env,request:new Request('https://boplo.app/flight/'+path,{method,headers:{Cookie:'boplo_session='+owner,Origin:origin,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined})});
 assert.equal((await call('unknown','workspace')).status,401);
 assert.equal((await call('alice','flights','POST',valid,'https://evil.example')).status,403);
 const saved=await call('alice','profile','PUT',{name:'Alice',country:'UK',authority:'UK CAA',licence:'PPL(A)',complete:true});assert.equal(saved.status,200);
 const response=await call('alice','flights','POST',valid);assert.equal(response.status,201);const {flight}=await response.json();
 assert.equal((await (await call('alice','workspace')).json()).flights.length,1);
 assert.equal((await (await call('bob','workspace')).json()).flights.length,0);
 assert.equal((await call('bob','flights/'+flight.id,'PUT',valid)).status,404);
 assert.equal((await call('bob','flights/'+flight.id,'DELETE')).status,404);
 assert.equal((await call('alice','flights/'+flight.id,'PUT',{...valid,minutes:80})).status,200);
 assert.equal((await (await call('alice','workspace')).json()).flights[0].minutes,80);
 assert.equal((await call('alice','flights/'+flight.id,'DELETE')).status,200);
 db.close();
});
