import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequest,hmac,verifyStripe,signObject,verifyObject,isPaidSession} from '../functions/api/[[path]].js';
import {sunPosition,lightFacts,validateInput,localDate,writePlan} from '../functions/lib/intelligence.js';
import {environment,providers} from './helpers.js';
const place={name:'Barcelona, Spain',latitude:41.3874,longitude:2.1686,timezone:'Europe/Madrid'};
const input={place,date:'2027-06-21',vibe:'Soft golden editorial',subject:'Friends / photo dump'};
test('solar direction and local time agree with expected Barcelona summer sunset',()=>{
 const f=lightFacts(input,null,Date.parse('2027-06-01'));
 assert.match(f.window.startLocal,/^(20|21):/);assert.ok(f.sun.azimuthDegrees>280&&f.sun.azimuthDegrees<310);assert.ok(f.sun.altitudeDegrees>0&&f.sun.altitudeDegrees<8);
 assert.equal(f.weatherStatus,'unavailable');assert.equal(f.conditions,null);
});
test('southern hemisphere, DST and local calendar dates are handled',()=>{
 const s={...input,place:{name:'Sydney',latitude:-33.8688,longitude:151.2093,timezone:'Australia/Sydney'},date:'2027-01-15'};
 const f=lightFacts(s,null,Date.parse('2027-01-01'));
 assert.equal(localDate(Date.parse(f.window.start),s.place.timezone),s.date);assert.match(f.window.startLocal,/^(19|20):/);
 assert.equal(localDate(Date.parse('2027-03-28T22:30:00Z'),'Europe/Madrid'),'2027-03-29');
});
test('night-flash windows have sun below horizon and polar day is not invented',()=>{
 assert.ok(lightFacts({...input,vibe:'City-night flash'},null,Date.parse('2027-06-01')).sun.altitudeDegrees<0);
 assert.throws(()=>lightFacts({...input,place:{name:'Longyearbyen',latitude:78.22,longitude:15.65,timezone:'Arctic/Longyearbyen'},vibe:'City-night flash'},null,Date.parse('2027-06-01')),/No suitable/);
});
test('reject past, invalid dates, coordinates and invalid categories',()=>{
 const now=Date.parse('2027-01-01');assert.throws(()=>validateInput({...input,date:'2027-02-30'},now));assert.throws(()=>validateInput({...input,date:'2026-01-01'},now));assert.throws(()=>validateInput({...input,place:{...place,latitude:999}},now));assert.throws(()=>validateInput({...input,vibe:'invented'},now));
});
test('weather at the selected hour is included, missing data stays unknown',()=>{
 const base=lightFacts(input,null,Date.parse('2027-06-01')),t=Date.parse(base.window.start)/1000;
 const f=lightFacts(input,{hourly:{time:[t],temperature_2m:[22],cloud_cover:[10],precipitation_probability:[5],wind_speed_10m:[8],weather_code:[1]}},Date.parse('2027-06-01'));
 assert.equal(f.conditions.temperatureC,22);assert.equal(f.weatherStatus,'forecast');
});
test('signed location supports Unicode, rejects changes and expiry',async()=>{
 const s='secret',data={place:{name:'São Paulo 日本'},exp:Date.now()+60000},token=await signObject(data,s);assert.deepEqual(await verifyObject(token,s),data);assert.equal(await verifyObject(token+'x',s),null);assert.equal(await verifyObject(await signObject({exp:1},s),s),null);
});
test('Stripe signature verifies exact body and rejects replay outside tolerance',async()=>{
 const raw='{"id":"evt_1"}',now=Date.now(),t=Math.floor(now/1000),sig=await hmac(t+'.'+raw,'secret');assert.ok(await verifyStripe(raw,`t=${t},v1=${sig}`,'secret',now));assert.equal(await verifyStripe(raw+' ',`t=${t},v1=${sig}`,'secret',now),false);assert.equal(await verifyStripe(raw,`t=${t},v1=${sig}`,'secret',now+400000),false);
});
test('amount, currency, owner and checkout status all gate entitlements',()=>{
 const row={id:'p',owner:'u',session_id:'cs_1'},s={id:'cs_1',status:'complete',payment_status:'paid',amount_total:499,currency:'gbp',metadata:{plan_id:'p',owner:'u'}};assert.ok(isPaidSession(s,row));for(const patch of [{amount_total:1},{currency:'usd'},{payment_status:'unpaid'},{status:'open'},{metadata:{plan_id:'p',owner:'other'}},{id:'cs_other'}])assert.equal(isPaidSession({...s,...patch},row),false);
});
test('AI errors and incomplete output never become a sellable plan',async()=>{
 await assert.rejects(writePlan(input,{}, {},async()=>new Response('{}',{status:500})));
 await assert.rejects(writePlan(input,{}, {},async()=>new Response(JSON.stringify({status:'incomplete'}))));
});
test('complete API flow protects content, verifies payment once, recovers and revokes',async()=>{
 const env=environment(),mock=providers(),original=globalThis.fetch;globalThis.fetch=mock.fetch;let cookie='';
 const call=async(path,data,extra={})=>{const request=new Request('http://localhost:4173/api/'+path,{method:data===undefined?'GET':'POST',headers:{Origin:'http://localhost:4173','Content-Type':'application/json',Cookie:cookie,...extra},body:data===undefined?undefined:JSON.stringify(data)});const res=await onRequest({request,env,waitUntil:p=>p.catch(()=>{})});if(res.headers.get('Set-Cookie'))cookie=res.headers.get('Set-Cookie').split(';')[0];return {status:res.status,data:await res.json()};};
 try{
  const geo=await call('locations?q=Barcelona');assert.equal(geo.status,200);
  const date=new Date(Date.now()+7*86400000).toISOString().slice(0,10),brief={placeToken:geo.data.places[0].token,date,vibe:input.vibe,subject:input.subject};
  const created=await call('preview',brief),id=created.data.id;assert.equal(created.status,201);assert.ok(!JSON.stringify(created.data).includes('arrivalLocal'));assert.equal(created.data.plan,undefined);
  const repeat=await call('preview',brief);assert.equal(repeat.data.id,id);assert.equal(mock.aiCalls,1);
  const locked=await call('plans/'+id);assert.equal(locked.data.plan,undefined);
  const checkout=await call('plans/'+id+'/checkout',{});assert.equal(checkout.status,200);const s=[...mock.sessions.values()][0];
  assert.equal((await call('plans/'+id+'/verify',{sessionId:s.id})).status,202);
  s.status='complete';s.payment_status='paid';s.amount_total=1;assert.equal((await call('plans/'+id+'/verify',{sessionId:s.id})).data.paid,false);
  s.amount_total=499;assert.equal((await call('plans/'+id+'/verify',{sessionId:s.id})).data.paid,true);
  assert.equal((await call('plans/'+id+'/verify',{sessionId:s.id})).data.paid,true);
  const paid=await call('plans/'+id);assert.equal(paid.data.plan.advice.shots.length,3);
  const recovery=await call('plans/'+id+'/recovery',{});cookie='';assert.equal((await call('plans/'+id)).status,404);
  assert.equal((await call('plans/'+id,undefined,{Authorization:'Bearer '+recovery.data.token})).data.status,'paid');
  await env.DB.prepare("UPDATE scout_plans SET status='refunded' WHERE id=?").bind(id).run();
  assert.equal((await call('plans/'+id,undefined,{Authorization:'Bearer '+recovery.data.token})).data.plan,undefined);
 }finally{globalThis.fetch=original;env.DB.close();}
});
test('missing configuration fails closed, and foreign-origin writes are rejected',async()=>{
 const env=environment();const context=(request,e)=>({request,env:e,waitUntil:p=>p});
 assert.equal((await onRequest(context(new Request('https://boplo.app/api/preview',{method:'POST'}),{}))).status,503);
 assert.equal((await onRequest(context(new Request('https://boplo.app/api/preview',{method:'POST',headers:{Origin:'https://other.test'}}),env))).status,403);env.DB.close();
});
