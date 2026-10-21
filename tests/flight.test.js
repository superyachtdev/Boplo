import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {onRequest,validateFlight,validateProfile,weather,debrief,shared} from '../functions/flight/[[path]].js';
const valid={date:'2026-01-12',departure:'EGHP',arrival:'EGHP',minutes:65,role:'dual',landings:4,points:[]};
test('flight records reject invalid times, dates, roles and coordinates',()=>{
 for(const changes of [{minutes:-5},{minutes:1.5},{date:'2026-02-30'},{date:'2099-01-01'},{role:'approved'},{points:[{lat:95,lng:0}]},{landings:1.5}])assert.throws(()=>validateFlight({...valid,...changes}));
 assert.equal(validateFlight(valid).minutes,65);
 assert.throws(()=>validateProfile({complete:true}),/Complete/);
 assert.equal(validateProfile({step:2}).complete,false);
 assert.equal(validateProfile({goalHours:'45',checklist:'[x] Plot the route'}).goalHours,45);
 assert.equal(validateProfile({checklist:'[ ] Radio calls'}).checklist,'[ ] Radio calls');
 assert.throws(()=>validateProfile({goalHours:5000}));
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

test('profile JSON fields and flight cost are validated',()=>{
 const p=validateProfile({syllabus:'{"uk":{"ex4":"done"}}',study:{airlaw:{seen:3}},currency:'GBP',rateAircraft:'210'});
 assert.equal(p.currency,'GBP');assert.equal(p.rateAircraft,210);assert.equal(JSON.parse(p.study).airlaw.seen,3);
 assert.throws(()=>validateProfile({syllabus:'[1,2]'}));assert.throws(()=>validateProfile({syllabus:'x'.repeat(13000)}));
 assert.equal(validateProfile({currency:'pounds'}).currency,'');
 assert.equal(validateFlight({...valid,cost:'245.5'}).cost,245.5);assert.equal(validateFlight(valid).cost,null);
 assert.throws(()=>validateFlight({...valid,cost:-3}));
});
test('weather returns nearest stations with TAFs and survives empty areas',async()=>{
 const calls=[];const fetcher=async u=>{calls.push(u);if(u.includes('/metar'))return new Response(JSON.stringify([{icaoId:'EGHI',name:'Southampton',lat:50.95,lon:-1.36,rawOb:'EGHI 211650Z 24012KT 9999 FEW030 14/08 Q1012',temp:14,dewp:8,wdir:240,wspd:12,visib:'6+',altim:1012,clouds:[{cover:'FEW',base:3000}],fltCat:'VFR'},{icaoId:'EGHI',lat:50.95,lon:-1.36}]),{status:200});return new Response(JSON.stringify([{icaoId:'EGHI',rawTAF:'TAF EGHI 211700Z 2118/2218 24010KT 9999 SCT035'}]),{status:200});};
 const out=await weather(new URL('https://boplo.app/flight/weather?lat=51.19&lng=-1.23'),{},fetcher);
 assert.equal(out.stations.length,1);assert.equal(out.stations[0].id,'EGHI');assert.match(out.stations[0].taf,/^TAF EGHI/);assert.ok(out.stations[0].dist>10&&out.stations[0].dist<20);
 const empty=await weather(new URL('https://boplo.app/flight/weather?lat=0&lng=-150'),{},async()=>new Response(null,{status:204}));
 assert.equal(empty.stations.length,0);
 await assert.rejects(()=>weather(new URL('https://boplo.app/flight/weather?lat=99&lng=0'),{},fetcher));
});
test('debrief only returns structured lists and needs a key',async()=>{
 await assert.rejects(()=>debrief({},{transcript:'x'.repeat(40)}),/not connected/);
 await assert.rejects(()=>debrief({GEMINI_API_KEY:'k'},{transcript:'short'}),/more/);
 const fetcher=async()=>new Response(JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({summary:'Circuits went well.',wentWell:['Radio calls'],workOn:['Flare height'],nextPrep:['Review glide approach'],questions:['When is solo?'],extra:'ignored'})}]}}]}),{status:200});
 const out=await debrief({GEMINI_API_KEY:'k'},{transcript:'Today we did circuits and my radio calls were good but flare was high.'},fetcher);
 assert.deepEqual(Object.keys(out).sort(),['nextPrep','questions','summary','wentWell','workOn']);assert.equal(out.workOn[0],'Flare height');
});

test('night landings, profile share hash and import',async()=>{
 assert.equal(validateFlight({...valid,landings:4,nightLandings:3}).nightLandings,3);
 assert.throws(()=>validateFlight({...valid,landings:2,nightLandings:3}));
 assert.equal(validateProfile({shareHash:'evil'}).shareHash,undefined);
 assert.equal(validateProfile({},{shareHash:'abc'}).shareHash,'abc');
 const db=new DatabaseSync(':memory:');
 for(const file of ['0002_darts_product.sql','0009_boplo_flight.sql'])db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const env={DB:{prepare(sql){let args=[];return {bind(...a){args=a;return this;},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){return db.prepare(sql).run(...args);}};}}};
 db.prepare('INSERT INTO darts_users(id,email,created_at,updated_at) VALUES(?,?,0,0)').run('al','al@example.com');
 const h=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('al')))].map(n=>n.toString(16).padStart(2,'0')).join('');
 db.prepare('INSERT INTO darts_sessions VALUES(?,?,?,?,?)').run('al','al',h,Date.now()+60000,Date.now());
 const call=(path,method='GET',b,cookie=true)=>onRequest({env,request:new Request('https://boplo.app/flight/'+path,{method,headers:{...(cookie?{Cookie:'boplo_session=al'}:{}),Origin:'https://boplo.app','Content-Type':'application/json'},body:b?JSON.stringify(b):undefined})});
 assert.equal((await call('profile','PUT',{name:'Alice Smith',country:'UK',authority:'UK CAA',licence:'PPL(A)',complete:true,notes:'private'})).status,200);
 const imp=await (await call('flights/import','POST',{flights:[valid,{...valid,role:'bad'},{...valid,minutes:30}]})).json();
 assert.equal(imp.flights.length,2);assert.equal(imp.errors[0].row,2);
 const {token}=await (await call('share','POST',{})).json();assert.match(token,/^[a-f0-9]{48}$/);
 const ws=await (await call('workspace')).json();assert.equal(ws.profile.shareOn,true);assert.equal(ws.profile.shareHash,undefined);
 await call('profile','PUT',{...ws.profile,shareHash:'x'});
 const pub=await call('shared?t='+token,'GET',undefined,false);assert.equal(pub.status,200);const v=await pub.json();
 assert.equal(v.student.name,'Alice');assert.equal(v.totals.flights,2);assert.equal(v.recent.length,2);
 assert.equal((await call('shared?t='+'0'.repeat(48),'GET',undefined,false)).status,404);
 await call('share','DELETE');assert.equal((await call('shared?t='+token,'GET',undefined,false)).status,404);
 db.close();
});
test('weather looks up a station by code and falls back to nearby',async()=>{
 const f=async u=>u.includes('metar?ids=EGLL')?new Response(JSON.stringify([{icaoId:'EGLL',name:'London Heathrow',lat:51.48,lon:-0.45,rawOb:'EGLL 211650Z 24010KT CAVOK 14/07 Q1012'}]),{status:200}):u.includes('metar?ids=EGHP')?new Response(null,{status:204}):u.includes('/taf')?new Response(JSON.stringify([{icaoId:'EGLL',rawTAF:'TAF EGLL'}]),{status:200}):new Response(JSON.stringify([{icaoId:'EGVO',lat:51.23,lon:-0.94,rawOb:'EGVO 211650Z 26017KT 9999 FEW034 11/03 Q1005'}]),{status:200});
 const a=await weather(new URL('https://x/flight/weather?ids=EGLL'),{},f);assert.equal(a.exact,true);assert.equal(a.stations[0].taf,'TAF EGLL');
 const b=await weather(new URL('https://x/flight/weather?ids=EGHP&lat=51.19&lng=-1.23'),{},f);assert.equal(b.exact,false);assert.equal(b.stations[0].id,'EGVO');
 const c=await weather(new URL('https://x/flight/weather?ids=EGHP'),{},f);assert.equal(c.stations.length,0);
});
