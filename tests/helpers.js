import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
export function database(){const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../migrations/0001_scout.sql',import.meta.url),'utf8'));return {prepare(sql){let args=[];return {bind(...values){args=values;return this;},async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){return db.prepare(sql).run(...args);}};},close(){db.close();}};}
export function environment(){return {DB:database(),SESSION_SECRET:'test-only-secret-with-at-least-32-characters',OPENAI_API_KEY:'test-only',STRIPE_SECRET_KEY:'sk_test_fixture',STRIPE_WEBHOOK_SECRET:'whsec_fixture',ALLOW_FREE_WEATHER:'true',APP_ORIGIN:'http://localhost:4173'};}
export const advice={title:'An easy city shoot',summary:'Look for an open background and leave space for movement.',direction:'Keep the low sun behind the subject and expose for their face.',shots:[{title:'The walk',prompt:'Walk across the frame with relaxed shoulders.'},{title:'The portrait',prompt:'Pause and turn gently toward the camera.'},{title:'The detail',prompt:'Photograph hands and clothing in open shade.'}],backup:'If rain arrives, find a covered public spot and check access before shooting.',packing:['Charged phone','Lens cloth'],caution:'Check local access and conditions.'};
export function providers(){const sessions=new Map();let calls=0;return {sessions,get aiCalls(){return calls;},fetch:async function(input,options={}){
 const url=new URL(input),reply=x=>new Response(JSON.stringify(x),{headers:{'Content-Type':'application/json'}});
 if(url.hostname==='geocoding-api.open-meteo.com')return reply({results:[{name:'Barcelona',admin1:'Catalonia',country:'Spain',latitude:41.3874,longitude:2.1686,timezone:'Europe/Madrid'}]});
 if(url.hostname.endsWith('open-meteo.com'))return reply({hourly:{time:[]}});
 if(url.hostname==='api.openai.com'){calls++;return reply({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(advice)}]}]});}
 if(url.hostname==='api.stripe.com'){
  if(options.method==='POST'){const p=new URLSearchParams(options.body),id='cs_test_'+p.get('metadata[plan_id]').replaceAll('-','');const s={id,status:'open',payment_status:'unpaid',amount_total:499,currency:'gbp',metadata:{plan_id:p.get('metadata[plan_id]'),owner:p.get('metadata[owner]')},payment_intent:'pi_'+id,url:'https://checkout.stripe.com/c/pay/'+id};sessions.set(id,s);return reply(s);}
  const s=sessions.get(url.pathname.split('/').at(-1));return s?reply(s):new Response('{}',{status:404});
 }
 throw new Error('Unexpected external request: '+url.hostname);
}};}
