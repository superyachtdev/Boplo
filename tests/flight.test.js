import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {onRequest,validateFlight,validateProfile,weather,debrief,shared} from '../functions/flight/[[path]].js';
import {verifySignature,planOf,publicBilling,FREE_LIMITS} from '../functions/lib/billing.js';
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
 for(const file of ['0002_darts_product.sql','0009_boplo_flight.sql','0010_boplo_billing.sql'])db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
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
 for(const file of ['0002_darts_product.sql','0009_boplo_flight.sql','0010_boplo_billing.sql'])db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const env={DB:{prepare(sql){let args=[];return {bind(...a){args=a;return this;},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){return db.prepare(sql).run(...args);}};}}};
 db.prepare('INSERT INTO darts_users(id,email,created_at,updated_at) VALUES(?,?,0,0)').run('al','al@example.com');
 const h=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('al')))].map(n=>n.toString(16).padStart(2,'0')).join('');
 db.prepare('INSERT INTO darts_sessions VALUES(?,?,?,?,?)').run('al','al',h,Date.now()+60000,Date.now());
 db.prepare("INSERT INTO flight_billing(user_id,customer_id,status,updated_at) VALUES('al','cus_test','active',0)").run();
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

test('free plan limits, paid features and billing state',async()=>{
 const db=new DatabaseSync(':memory:');
 for(const file of ['0002_darts_product.sql','0009_boplo_flight.sql','0010_boplo_billing.sql'])db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const env={DB:{prepare(sql){let args=[];return {bind(...a){args=a;return this;},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){return db.prepare(sql).run(...args);}};}},STRIPE_PUBLISHABLE_KEY:'pk_test_x',STRIPE_SECRET_KEY:'sk_test_x'};
 db.prepare('INSERT INTO darts_users(id,email,created_at,updated_at) VALUES(?,?,0,0)').run('fr','fr@example.com');
 const h=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('fr')))].map(n=>n.toString(16).padStart(2,'0')).join('');
 db.prepare('INSERT INTO darts_sessions VALUES(?,?,?,?,?)').run('fr','fr',h,Date.now()+60000,Date.now());
 const call=(path,method='GET',b)=>onRequest({env,request:new Request('https://boplo.app/flight/'+path,{method,headers:{Cookie:'boplo_session=fr',Origin:'https://boplo.app','Content-Type':'application/json'},body:b?JSON.stringify(b):undefined})});
 for(let i=0;i<FREE_LIMITS.flights;i++)assert.equal((await call('flights','POST',valid)).status,201);
 assert.equal((await call('flights','POST',valid)).status,402);
 assert.equal((await call('flights/import','POST',{flights:[valid]})).status,402);
 assert.equal((await call('share','POST',{})).status,402);
 // owner emails always get Advanced, without a subscription
 env.OWNER_EMAILS=' someone@else.com , FR@example.com ';
 const own=await (await call('workspace')).json();assert.equal(own.billing.plan,'advanced');assert.equal(own.billing.owner,true);
 assert.equal((await call('flights','POST',valid)).status,201);
 db.prepare("DELETE FROM flight_records WHERE rowid=(SELECT MAX(rowid) FROM flight_records)").run();
 delete env.OWNER_EMAILS;
 const ws=await (await call('workspace')).json();assert.equal(ws.billing.plan,'free');assert.equal(ws.billing.trialAvailable,false);assert.equal(ws.billing.ready,true);assert.equal(publicBilling({},null).plan,'advanced');
 // an abandoned trial checkout stays free; a paid subscription unlocks everything
 db.prepare("INSERT INTO flight_billing(user_id,customer_id,status,updated_at) VALUES('fr','cus_1','incomplete',0)").run();
 assert.equal(planOf(db.prepare("SELECT * FROM flight_billing WHERE user_id='fr'").get()),'free');
 db.prepare("UPDATE flight_billing SET status='trialing' WHERE user_id='fr'").run();
 assert.equal((await call('flights','POST',valid)).status,201);
 assert.equal(publicBilling(env,{status:'canceled'}).plan,'free');
 // your data: export and delete
 const ex=await call('account/export');assert.equal(ex.status,200);const data=await ex.json();assert.equal(data.flights.length,FREE_LIMITS.flights+1);
 assert.equal((await call('account/delete','POST',{confirm:'nope'})).status,400);
 const del=await call('account/delete','POST',{confirm:'DELETE'});assert.equal(del.status,200);assert.match(del.headers.get('Set-Cookie'),/Max-Age=0/);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM flight_records WHERE user_id='fr'").get().n,0);
 assert.equal((await call('workspace')).status,401);
});
test('stripe webhook signatures are verified',async()=>{
 const secret='whsec_test',payload='{"type":"customer.subscription.updated"}',t=Math.floor(Date.now()/1000);
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const sig=[...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${t}.${payload}`)))].map(b=>b.toString(16).padStart(2,'0')).join('');
 assert.equal(await verifySignature(payload,`t=${t},v1=${sig}`,secret),true);
 assert.equal(await verifySignature(payload+' ',`t=${t},v1=${sig}`,secret),false);
 assert.equal(await verifySignature(payload,`t=${t-1000},v1=${sig}`,secret),false);
 assert.equal(await verifySignature(payload,`t=${t},v1=${sig}`,'whsec_other'),false);
 const env={DB:{prepare(){return {bind(){return this;},async first(){return null;},async run(){}};}},STRIPE_FLIGHT_WEBHOOK_SECRET:secret};
 const bad=await onRequest({env,request:new Request('https://boplo.app/flight/billing/webhook',{method:'POST',headers:{'Stripe-Signature':'t=1,v1=00'},body:payload})});
 assert.equal(bad.status,400);
 const good=await onRequest({env,request:new Request('https://boplo.app/flight/billing/webhook',{method:'POST',headers:{'Stripe-Signature':`t=${t},v1=${sig}`},body:payload})});
 assert.equal(good.status,200);
});
test('checkout creates prices once, charges straight away (no trial) and stays free until confirmed',async()=>{
 const {subscribe}=await import('../functions/lib/billing.js');
 const db=new DatabaseSync(':memory:');
 for(const file of ['0002_darts_product.sql','0009_boplo_flight.sql','0010_boplo_billing.sql'])db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 db.prepare('INSERT INTO darts_users(id,email,created_at,updated_at) VALUES(?,?,0,0)').run('u1','u1@example.com');
 const env={STRIPE_SECRET_KEY:'sk_test_x',DB:{prepare(sql){let args=[];return {bind(...a){args=a;return this;},async first(){return db.prepare(sql).get(...args)||null;},async run(){return db.prepare(sql).run(...args);}};}}};
 const calls=[];
 const fake=async(url,init)=>{const u=new URL(url),body=new URLSearchParams(init.body||'');calls.push({m:init.method,p:u.pathname,q:u.searchParams,b:body});const r=o=>new Response(JSON.stringify(o),{status:200});
  if(u.pathname==='/v1/customers')return r({id:'cus_1'});
  if(u.pathname==='/v1/prices'&&init.method==='GET')return r({data:[]});
  if(u.pathname==='/v1/products/search')return r({data:[]});
  if(u.pathname==='/v1/products')return r({id:'prod_1'});
  if(u.pathname==='/v1/prices')return r({id:'price_1',currency:'usd'});
  if(u.pathname==='/v1/subscriptions'&&init.method==='GET')return r({data:[]});
  if(u.pathname==='/v1/subscriptions')return r({id:'sub_1',status:'incomplete',latest_invoice:{amount_due:9999,currency:'usd',payment_intent:{client_secret:'pi_secret'}}});
  return new Response('{}',{status:404});};
 const out=await subscribe(env,{id:'u1',email:'u1@example.com'},{interval:'yearly'},'https://boplo.app',fake);
 assert.equal(out.clientSecret,'pi_secret');assert.equal(out.mode,'payment');assert.equal(out.trial,false);assert.equal(out.amountDue,9999);
 const price=calls.find(c=>c.p==='/v1/prices'&&c.m==='POST');assert.equal(price.b.get('unit_amount'),'9999');assert.equal(price.b.get('recurring[interval]'),'year');assert.equal(price.b.get('lookup_key'),'boplo_flight_advanced_yearly');
 const sub=calls.find(c=>c.p==='/v1/subscriptions'&&c.m==='POST');assert.equal(sub.b.get('items[0][price]'),'price_1');assert.equal(sub.b.get('trial_period_days'),null);assert.equal(sub.b.get('payment_behavior'),'default_incomplete');assert.deepEqual(sub.b.getAll('expand[]'),['latest_invoice.payment_intent','pending_setup_intent']);
 const row=db.prepare("SELECT * FROM flight_billing WHERE user_id='u1'").get();assert.equal(row.customer_id,'cus_1');assert.equal(row.status,'incomplete');
});
test('promotion codes discount the first payment and can skip the trial',async()=>{
 const {promoSummary,subscribe,checkPromo}=await import('../functions/lib/billing.js');
 assert.equal(promoSummary({code:'OWNER',id:'promo_1',coupon:{amount_off:9899,currency:'usd',duration:'once'},metadata:{skip_trial:'true'}},'yearly').firstAmount,100);
 assert.equal(promoSummary({code:'HALF',id:'promo_2',coupon:{percent_off:50,duration:'forever'},metadata:{}},'monthly').firstAmount,600);
 assert.equal(promoSummary({code:'EUR',id:'p',coupon:{amount_off:500,currency:'eur',duration:'once'},metadata:{}},'yearly'),null);
 const db=new DatabaseSync(':memory:');
 for(const file of ['0002_darts_product.sql','0009_boplo_flight.sql','0010_boplo_billing.sql'])db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 db.prepare('INSERT INTO darts_users(id,email,created_at,updated_at) VALUES(?,?,0,0)').run('o','o@example.com');
 const env={STRIPE_SECRET_KEY:'sk_test_x',DB:{prepare(sql){let args=[];return {bind(...a){args=a;return this;},async first(){return db.prepare(sql).get(...args)||null;},async run(){return db.prepare(sql).run(...args);}};}}};
 const calls=[];
 const fake=async(url,init)=>{const u=new URL(url),body=new URLSearchParams(init.body||'');calls.push({m:init.method,p:u.pathname,q:u.searchParams,b:body});const r=o=>new Response(JSON.stringify(o),{status:200});
  if(u.pathname==='/v1/promotion_codes')return r({data:u.searchParams.get('code')==='OWNER'?[{id:'promo_1',code:'OWNER',coupon:{valid:true,amount_off:9899,currency:'usd',duration:'once'},metadata:{skip_trial:'true'}}]:[]});
  if(u.pathname==='/v1/customers')return r({id:'cus_o'});
  if(u.pathname==='/v1/prices'&&init.method==='GET')return r({data:[{id:'price_y',currency:'usd'}]});
  if(u.pathname==='/v1/subscriptions'&&init.method==='GET')return r({data:[]});
  if(u.pathname==='/v1/subscriptions')return r({id:'sub_o',status:'incomplete',latest_invoice:{amount_due:100,currency:'usd',payment_intent:{client_secret:'pi_secret'}}});
  return new Response('{}',{status:404});};
 await assert.rejects(checkPromo(env,{code:'NOPE',interval:'yearly'},fake),/isn’t valid/);
 const ok=await checkPromo(env,{code:'OWNER',interval:'yearly'},fake);assert.equal(ok.firstAmount,100);assert.equal(ok.skipTrial,true);
 const out=await subscribe(env,{id:'o',email:'o@example.com'},{interval:'yearly',promo:'OWNER'},'https://boplo.app',fake);
 assert.equal(out.mode,'payment');assert.equal(out.trial,false);
 const sub=calls.find(c=>c.p==='/v1/subscriptions'&&c.m==='POST');assert.equal(sub.b.get('discounts[0][promotion_code]'),'promo_1');assert.equal(sub.b.get('trial_period_days'),null);
});
test('ask boplo streams answers, caches the system prompt and enforces daily limits',async()=>{
 const {ask,usage,cleanMessages}=await import('../functions/lib/ask.js');
 const db=new DatabaseSync(':memory:');
 const env={ANTHROPIC_API_KEY:'sk-ant-x',DB:{prepare(sql){let args=[];return {bind(...a){args=a;return this;},async first(){return db.prepare(sql).get(...args)||null;},async run(){return db.prepare(sql).run(...args);}};}}};
 let sent=null;
 const fake=async(url,init)=>{sent={url,body:JSON.parse(init.body),headers:init.headers};const ev=o=>`event: x\ndata: ${JSON.stringify(o)}\n\n`;
  const body=ev({type:'message_start'})+ev({type:'content_block_delta',delta:{type:'text_delta',text:'Lift comes '}})+ev({type:'content_block_delta',delta:{type:'text_delta',text:'from the wing. Sources: PHAK'}})+ev({type:'message_stop'});
  return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(body));c.close();}}),{status:200});};
 const user={id:'s1'};
 const r=await ask(env,user,'free',{messages:[{role:'assistant',content:'hi'},{role:'user',content:'How does a wing make lift?'}],context:'Licence: PPL(A), UK CAA'},fake);
 const text=await r.response.text();await r.done;
 assert.match(text,/"t":"Lift comes "/);assert.match(text,/"done":true/);assert.match(text,/"left":2/);
 assert.equal(sent.url,'https://api.anthropic.com/v1/messages');assert.equal(sent.body.model,'claude-haiku-5-5');assert.equal(sent.body.stream,true);
 assert.equal(sent.body.system[0].cache_control.type,'ephemeral');assert.match(sent.body.system[1].text,/student_context/);
 assert.equal(sent.body.messages.length,1);assert.equal(sent.body.messages[0].role,'user');assert.equal(sent.headers['anthropic-version'],'2023-06-01');
 for(let i=0;i<2;i++){const x=await ask(env,user,'free',{messages:[{role:'user',content:'q'}]},fake);await x.response.text();await x.done;}
 assert.equal((await usage(env,'s1','free')).left,0);
 await assert.rejects(ask(env,user,'free',{messages:[{role:'user',content:'q'}]},fake),e=>e.status===402);
 assert.equal((await usage(env,'s1','advanced')).left,37);
 assert.throws(()=>cleanMessages({messages:[]}),/Ask a question/);
 assert.equal(cleanMessages({messages:[{role:'user',content:'a'},{role:'user',content:'b'}]}).length,1);
});
test('mock checkride is Advanced-only and adds the examiner brief',async()=>{
 const {ask}=await import('../functions/lib/ask.js');
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE flight_ai_usage (user_id TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day))');
 const env={ANTHROPIC_API_KEY:'sk-ant-x',DB:{prepare(sql){let args=[];return {bind(...a){args=a;return this;},async first(){return db.prepare(sql).get(...args)||null;},async run(){return db.prepare(sql).run(...args);}};}}};
 let sent=null;
 const fake=async(url,init)=>{sent=JSON.parse(init.body);const body=`data: ${JSON.stringify({type:'content_block_delta',delta:{type:'text_delta',text:'Scenario. First question?'}})}\n\n`;return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(body));c.close();}}),{status:200});};
 await assert.rejects(ask(env,{id:'e1'},'free',{mode:'examiner',messages:[{role:'user',content:'Begin'}]},fake),e=>e.status===402);
 const msgs=[];for(let i=0;i<20;i++){msgs.push({role:'user',content:'a'+i});msgs.push({role:'assistant',content:'q'+i});}msgs.push({role:'user',content:'[END]'});
 const r=await ask(env,{id:'e1'},'advanced',{mode:'examiner',setup:{focus:'weather',style:'strict',questions:12},messages:msgs},fake);await r.response.text();await r.done;
 assert.match(sent.system[1].text,/MOCK CHECKRIDE MODE/);assert.match(sent.system[1].text,/weather theory/);assert.match(sent.system[1].text,/about 12 questions/);assert.match(sent.system[1].text,/push back/);
 assert.equal(sent.messages.length,41);assert.equal(sent.max_tokens,1500);
});
test('training reminders pick the right email and can be switched off',async()=>{
 const {pickNudge,runNudges,unsubToken,nudgesOff}=await import('../functions/lib/nudges.js');
 const now=Date.parse('2026-10-22T07:17:00Z');
 assert.equal(pickNudge({profile:{},lastFlight:'2026-10-18',flights:3,now}),null);
 assert.match(pickNudge({profile:{name:'Gianni Wood'},lastFlight:'2026-10-08',flights:3,now}).lines[0],/Hi Gianni, it’s been 14 days/);
 assert.equal(pickNudge({profile:{},lastFlight:'2026-10-01',flights:3,sent:{gap:now-3*86400000},now}),null);
 assert.match(pickNudge({profile:{},lastFlight:'2026-07-01',flights:3,now}).subject,/Time for a refresher/);
 const lesson=pickNudge({profile:{lessonDate:'2026-10-23',nextLesson:'Lesson 12'},lastFlight:'2026-10-21',flights:3,now});assert.equal(lesson.kind,'lesson:2026-10-23');
 assert.equal(pickNudge({profile:{lessonDate:'2026-10-23'},lastFlight:'2026-10-21',flights:3,sent:{'lesson:2026-10-23':now},now}),null);
 const db=new DatabaseSync(':memory:');
 for(const file of ['0002_darts_product.sql','0009_boplo_flight.sql'])db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const env={CRON_SECRET:'s3cret',RESEND_API_KEY:'re_x',EMAIL_FROM:'Boplo <hi@boplo.app>',DB:{prepare(sql){let args=[];return {bind(...a){args=a;return this;},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){return db.prepare(sql).run(...args);}};}}};
 for(const [id,on] of [['a',true],['b',false]]){db.prepare('INSERT INTO darts_users(id,email,created_at,updated_at) VALUES(?,?,0,0)').run(id,id+'@example.com');db.prepare('INSERT INTO flight_profiles(user_id,data,updated_at) VALUES(?,?,0)').run(id,JSON.stringify({name:'P',reminders:on}));db.prepare('INSERT INTO flight_records(id,user_id,data,created_at,updated_at) VALUES(?,?,?,0,0)').run('f'+id,id,JSON.stringify({date:'2026-09-20',minutes:60}));}
 const mails=[];const fake=async(u,init)=>{mails.push(JSON.parse(init.body));return new Response('{}',{status:200});};
 const out=await runNudges(env,{now,fetcher:fake});assert.equal(out.sent,1);assert.equal(mails[0].to[0],'a@example.com');assert.match(mails[0].html,/nudges\/off\?u=a&amp;t=|nudges\/off\?u=a&t=/);
 assert.equal((await runNudges(env,{now:now+86400000,fetcher:fake})).sent,0);
 const bad=await nudgesOff(env,new URL('https://boplo.app/flight/nudges/off?u=a&t=nope'));assert.equal(bad.status,400);
 const ok=await nudgesOff(env,new URL(`https://boplo.app/flight/nudges/off?u=a&t=${await unsubToken(env,'a')}`));assert.equal(ok.status,200);
 assert.equal(JSON.parse(db.prepare("SELECT data FROM flight_profiles WHERE user_id='a'").get().data).reminders,false);
 const cron=await onRequest({env,request:new Request('https://boplo.app/flight/cron/nudges',{method:'POST',headers:{Authorization:'Bearer wrong'}})});assert.equal(cron.status,401);
});
