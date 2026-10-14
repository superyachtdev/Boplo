import {validateInput,lightFacts,getWeather,writePlan} from '../lib/intelligence.js';
const encoder=new TextEncoder(),PRICE=499,CURRENCY='gbp';
class HttpError extends Error {constructor(status,message){super(message);this.status=status;}}
const fail=(status,message)=>{throw new HttpError(status,message);};
const json=(data,status=200,extra={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',...extra}});
export async function digest(text){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(text)))].map(v=>v.toString(16).padStart(2,'0')).join('');}
export async function hmac(text,secret){const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,encoder.encode(text)))].map(v=>v.toString(16).padStart(2,'0')).join('');}
export function equal(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let result=0;for(let i=0;i<a.length;i++)result|=a.charCodeAt(i)^b.charCodeAt(i);return result===0;}
export async function signObject(data,secret){const value=btoa(String.fromCharCode(...encoder.encode(JSON.stringify(data))));return value+'.'+await hmac(value,secret);}
export async function verifyObject(token,secret){try{const [value,sig]=token.split('.');if(!equal(await hmac(value,secret),sig))return null;const data=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value),c=>c.charCodeAt(0))));return data.exp>Date.now()?data:null;}catch{return null;}}
export async function verifyStripe(raw,header,secret,now=Date.now()){
  const parts=(header||'').split(',').map(p=>p.split('=')),time=parts.find(p=>p[0]==='t')?.[1];
  if(!time||Math.abs(now/1000-Number(time))>300)return false;
  const sig=await hmac(time+'.'+raw,secret);return parts.some(p=>p[0]==='v1'&&equal(p[1],sig));
}
export function isPaidSession(s,row){return s.status==='complete'&&s.payment_status==='paid'&&s.amount_total===PRICE&&s.currency===CURRENCY&&s.metadata?.plan_id===row.id&&s.metadata?.owner===row.owner&&(!row.session_id||row.session_id===s.id);}
function configuration(env){return ['DB','SESSION_SECRET','OPENAI_API_KEY','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET'].filter(k=>!env[k]).concat(env.STRIPE_SECRET_KEY?.startsWith('sk_live_')&&!env.OPEN_METEO_API_KEY?['OPEN_METEO_API_KEY']:[]);}
async function body(request){if(Number(request.headers.get('Content-Length'))>12000)fail(413,'Request is too large.');const raw=await request.text();if(raw.length>12000)fail(413,'Request is too large.');try{return JSON.parse(raw);}catch{fail(400,'Invalid request.');}}
async function limit(env,key,max,period=86400000){const bucket=Math.floor(Date.now()/period),k=key+':'+bucket;const r=await env.DB.prepare('INSERT INTO rate_limits(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(k,(bucket+1)*period).first();if(r.count>max)fail(429,'Too many requests. Please try again later.');}
async function stripe(env,path,params,idem){const res=await fetch('https://api.stripe.com/v1/'+path,{method:params?'POST':'GET',headers:{Authorization:'Bearer '+env.STRIPE_SECRET_KEY,...(params?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(idem?{'Idempotency-Key':idem}:{})},body:params?new URLSearchParams(params):undefined,signal:AbortSignal.timeout(15000)});if(!res.ok)fail(502,'Payment service unavailable. Please try again.');return res.json();}
async function grant(env,s){const row=await env.DB.prepare('SELECT * FROM scout_plans WHERE id=?').bind(s.metadata?.plan_id||'').first();if(!row||!isPaidSession(s,row))fail(400,'Payment does not match this plan.');await env.DB.prepare("UPDATE scout_plans SET status='paid',session_id=?,payment_intent=?,paid_at=? WHERE id=? AND status='preview'").bind(s.id,typeof s.payment_intent==='string'?s.payment_intent:s.payment_intent?.id||null,Date.now(),row.id).run();return row.id;}
export async function onRequest(context){
  const {request,env}=context,url=new URL(request.url),path=url.pathname.replace(/^\/api\/?/,'');let cookie='';
  const respond=(data,status=200)=>json(data,status,cookie?{'Set-Cookie':cookie}:{});
  try{
    if(path==='status'&&request.method==='GET')return json({ready:configuration(env).length===0,paymentsMode:env.STRIPE_SECRET_KEY?.startsWith('sk_live_')?'live':'test',price:PRICE,currency:CURRENCY});
    if(!env.DB||!env.SESSION_SECRET)fail(503,'Scout Plans are not open yet. Payments and planning services are still being connected.');
    if(['preview','locations'].includes(path)&&configuration(env).length)fail(503,'Scout Plans are not open yet. Payments and planning services are still being connected.');
    if(path==='webhook'&&request.method==='POST'){
      if(!env.STRIPE_WEBHOOK_SECRET||!env.STRIPE_SECRET_KEY)fail(503,'Payment verification is unavailable.');
      const raw=await request.text();if(raw.length>250000)fail(413,'Request too large.');if(!await verifyStripe(raw,request.headers.get('stripe-signature'),env.STRIPE_WEBHOOK_SECRET))fail(400,'Invalid signature.');
      const event=JSON.parse(raw),s=event.data?.object;
      if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type)&&s.payment_status==='paid')await grant(env,await stripe(env,'checkout/sessions/'+encodeURIComponent(s.id)));
      if(event.type==='charge.refunded'&&s.refunded)await env.DB.prepare("UPDATE scout_plans SET status='refunded' WHERE payment_intent=?").bind(s.payment_intent).run();
      return json({received:true});
    }
    if(!['GET','POST'].includes(request.method))fail(405,'Method not allowed.');
    if(request.method==='POST'&&request.headers.get('Origin')!==url.origin)fail(403,'Please use the Boplo website to make this request.');
    if(request.method==='POST'&&!request.headers.get('Content-Type')?.includes('application/json'))fail(415,'Expected JSON.');
    let session=await verifyObject((request.headers.get('Cookie')||'').match(/(?:^|;\s*)boplo_session=([^;]+)/)?.[1]||'',env.SESSION_SECRET);
    if(!session){session={owner:crypto.randomUUID(),exp:Date.now()+365*86400000};cookie='boplo_session='+await signObject(session,env.SESSION_SECRET)+'; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000'+(url.protocol==='https:'?'; Secure':'');}
    const owner=session.owner;
    const ip=await digest((request.headers.get('CF-Connecting-IP')||'local')+env.SESSION_SECRET);
    if(path==='locations'&&request.method==='GET'){
      await limit(env,'geo:'+ip,60,3600000);const q=(url.searchParams.get('q')||'').trim();if(q.length<2||q.length>100)fail(400,'Enter a city or town (2–100 characters).');
      const remote=new URL('https://'+(env.OPEN_METEO_API_KEY?'customer-':'')+'geocoding-api.open-meteo.com/v1/search');remote.search=new URLSearchParams({name:q,count:'6',language:'en',format:'json'}).toString();if(env.OPEN_METEO_API_KEY)remote.searchParams.set('apikey',env.OPEN_METEO_API_KEY);
      const response=await fetch(remote,{signal:AbortSignal.timeout(10000)});if(!response.ok)fail(502,'Location search is unavailable. Try again shortly.');
      const data=await response.json(),places=[];
      for(const p of data.results||[]){if(!p.timezone)continue;const place={name:[p.name,p.admin1,p.country].filter(Boolean).join(', '),latitude:p.latitude,longitude:p.longitude,timezone:p.timezone};places.push({...place,token:await signObject({place,exp:Date.now()+3600000},env.SESSION_SECRET)});}
      return respond({places});
    }
    if(path==='preview'&&request.method==='POST'){
      const data=await body(request),signed=await verifyObject(data.placeToken||'',env.SESSION_SECRET);if(!signed?.place)fail(400,'Please search and select your location again.');
      let input;try{input=validateInput({...data,place:signed.place});}catch(e){fail(400,e.message);}
      const recent=await env.DB.prepare("SELECT * FROM scout_plans WHERE owner=? AND input=? AND created>? AND status IN ('preview','paid') ORDER BY created DESC LIMIT 1").bind(owner,JSON.stringify(input),Date.now()-3600000).first();
      if(recent)return respond({id:recent.id,preview:JSON.parse(recent.preview),status:recent.status});
      await limit(env,'preview:'+ip,5);await limit(env,'preview-owner:'+owner,5);await limit(env,'preview-global',Number(env.DAILY_AI_LIMIT)||100);
      const weather=await getWeather(input,env);let facts;try{facts=lightFacts(input,weather);}catch(e){fail(422,e.message);}
      const full=await writePlan(input,facts,env),id=crypto.randomUUID();
      // Only this deliberate subset crosses the paywall. Full content never reaches unpaid clients.
      const preview={location:input.place.name,date:input.date,vibe:input.vibe,subject:input.subject,weatherAvailable:facts.weatherStatus==='forecast',weatherNote:facts.weatherStatus==='forecast'?'Hourly forecast included. Conditions can change.':'Weather is not available for this date. The plan uses calculated sun position with conditional weather advice.',scope:'City-level guidance. Exact street shadows and access are not surveyed.',includes:['Arrival and light window','Sun direction and positioning','Three personalised shot prompts','Weather backup and packing checklist'],price:PRICE,currency:CURRENCY};
      await env.DB.prepare('INSERT INTO scout_plans(id,owner,input,preview,full_plan,created) VALUES(?,?,?,?,?,?)').bind(id,owner,JSON.stringify(input),JSON.stringify(preview),JSON.stringify(full),Date.now()).run();
      context.waitUntil(env.DB.prepare('DELETE FROM rate_limits WHERE expires<?').bind(Date.now()).run());
      return respond({id,preview,status:'preview'},201);
    }
    if(path==='plans'&&request.method==='GET'){
      const rows=await env.DB.prepare('SELECT id,preview,status,created FROM scout_plans WHERE owner=? ORDER BY created DESC LIMIT 100').bind(owner).all();return respond({plans:rows.results.map(r=>({...r,preview:JSON.parse(r.preview)}))});
    }
    const match=path.match(/^plans\/([a-f0-9-]{36})(?:\/(checkout|verify|recovery))?$/);
    if(match){
      const row=await env.DB.prepare('SELECT * FROM scout_plans WHERE id=?').bind(match[1]).first();
      const bearer=request.headers.get('Authorization')?.replace(/^Bearer /,'');
      const recovered=!!(row?.recovery_hash&&bearer&&equal(row.recovery_hash,await digest(bearer)));
      if(!row||(row.owner!==owner&&!recovered))fail(404,'Plan not found in this browser. Use your saved access link to open it.');
      if(!match[2]&&request.method==='GET')return respond({id:row.id,status:row.status,preview:JSON.parse(row.preview),...(row.status==='paid'?{plan:JSON.parse(row.full_plan)}:{})});
      if(match[2]==='recovery'&&request.method==='POST'){
        if(row.status!=='paid')fail(403,'Unlock the plan first.');const token=crypto.randomUUID()+crypto.randomUUID();await env.DB.prepare('UPDATE scout_plans SET recovery_hash=? WHERE id=?').bind(await digest(token),row.id).run();return respond({token});
      }
      if(match[2]==='checkout'&&request.method==='POST'){
        if(configuration(env).length)fail(503,'Checkout is temporarily unavailable.');
        if(row.status==='paid')return respond({paid:true});if(row.status==='refunded')fail(409,'This purchase was refunded. Create a new plan.');
        if(Date.now()-row.created>23*3600000||Date.parse(JSON.parse(row.full_plan).facts.window.end)<Date.now())fail(409,'This preview has expired. Create a fresh preview before paying.');
        await limit(env,'checkout:'+owner,30,3600000);
        if(row.session_id){const existing=await stripe(env,'checkout/sessions/'+row.session_id);if(isPaidSession(existing,row)){await grant(env,existing);return respond({paid:true});}if(existing.status==='open')return respond({url:existing.url});if(existing.status!=='expired')fail(409,'Your payment is still processing. Please wait before trying again.');}
        const origin=env.APP_ORIGIN||url.origin;
        if(!/^https:\/\//.test(origin)&&!origin.startsWith('http://localhost'))fail(503,'Checkout is not configured.');
        const s=await stripe(env,'checkout/sessions',{'mode':'payment','payment_method_types[0]':'card','line_items[0][price_data][currency]':CURRENCY,'line_items[0][price_data][unit_amount]':String(PRICE),'line_items[0][price_data][product_data][name]':'Boplo Scout Plan','line_items[0][quantity]':'1','metadata[plan_id]':row.id,'metadata[owner]':row.owner,'client_reference_id':row.id,'success_url':origin+'/?checkout=success&session_id={CHECKOUT_SESSION_ID}#dashboard/scout/'+row.id,'cancel_url':origin+'/?checkout=cancelled#dashboard/scout/'+row.id},'scout-'+row.id+'-'+(row.session_id||'first'));
        await env.DB.prepare('UPDATE scout_plans SET session_id=? WHERE id=?').bind(s.id,row.id).run();return respond({url:s.url});
      }
      if(match[2]==='verify'&&request.method==='POST'){
        if(!env.STRIPE_SECRET_KEY)fail(503,'Payment verification is temporarily unavailable.');
        const data=await body(request);if(!/^cs_[a-zA-Z0-9_]+$/.test(data.sessionId||''))fail(400,'Invalid checkout reference.');await limit(env,'verify:'+owner,60,3600000);
        const s=await stripe(env,'checkout/sessions/'+data.sessionId);if(!isPaidSession(s,row))return respond({paid:false},202);await grant(env,s);return respond({paid:true});
      }
    }
    fail(404,'Not found.');
  }catch(e){return respond({error:e.status?e.message:'Planning is temporarily unavailable. Please retry. No new payment has been taken.'},e.status||503);}
}
