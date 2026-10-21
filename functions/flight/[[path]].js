const json = (data, status=200) => new Response(JSON.stringify(data), {status, headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const fail = (status,message) => {throw Object.assign(new Error(message),{status});};
const text = (value,max=200) => String(value ?? '').trim().slice(0,max);
function number(value,min,max,label) {const n=Number(value);if(!Number.isFinite(n)||n<min||n>max)fail(400,`Enter a valid ${label}.`);return n;}
function date(value,required=false) {const s=text(value,10);if(!s&&!required)return '';if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s)fail(400,'Enter a valid date.');return s;}
export function validateProfile(input) {
 const p={};
 for(const key of ['name','country','authority','licence','airport','school','aircraft','registration','frequency','topics','nextLesson','questions','notes','checklist','countryCode','regime'])p[key]=text(input[key],['notes','questions','checklist'].includes(key)?3000:200);
 p.target=date(input.target);p.lessonDate=date(input.lessonDate);p.openingMinutes=number(input.openingMinutes??0,0,600000,'opening flight time');p.goalHours=Math.round(number(input.goalHours||0,0,2000,'hours goal'));p.step=Math.round(number(input.step??0,0,5,'onboarding step'));p.complete=input.complete===true;
 if(p.complete&&(!p.name||!p.authority||!p.licence||!p.country))fail(400,'Complete your name, country, authority and training goal.');
 return p;
}
export function validateFlight(input) {
 const f={};for(const key of ['departure','arrival','aircraft','registration','instructor','lesson'])f[key]=text(input[key],100);
 f.date=date(input.date,true);if(f.date>new Date().toISOString().slice(0,10))fail(400,'Log completed flights only.');
 if(!f.departure||!f.arrival)fail(400,'Enter departure and arrival airports.');
 f.minutes=number(input.minutes,1,1440,'duration in minutes');if(!Number.isInteger(f.minutes))fail(400,'Duration must be whole minutes.');
 f.role=text(input.role);if(!['dual','solo','pic'].includes(f.role))fail(400,'Choose a flight role.');
 f.landings=number(input.landings??0,0,100,'landing count');if(!Number.isInteger(f.landings))fail(400,'Landing count must be a whole number.');
 f.notes=text(input.notes,3000);
 f.points=[];
 if(input.points!=null&&!Array.isArray(input.points))fail(400,'Route coordinates must be a list.');
 if(input.points?.length>2000)fail(400,'Use at most 2,000 track points.');
 for(const p of input.points||[])f.points.push({lat:number(p.lat,-90,90,'latitude'),lng:number(p.lng,-180,180,'longitude')});
 f.routeKind=input.routeKind==='track'?'track':'endpoints';
 return f;
}
export async function onRequest({request,env}) {
 try {
 const url=new URL(request.url),path=url.pathname.replace(/^\/flight\/?/,'');
 if(!['GET','POST','PUT','DELETE'].includes(request.method))return json({error:'Method not allowed.'},405);
 if(request.method!=='GET'&&request.headers.get('Origin')!==url.origin)fail(403,'Request origin does not match.');
 if(!env.DB)fail(503,'The Flight database is not connected yet.');
 const token=(request.headers.get('Cookie')||'').match(/(?:^|;\s*)boplo_session=([^;]+)/)?.[1];
 if(!token)fail(401,'Sign in to open your flight desk.');
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))].map(n=>n.toString(16).padStart(2,'0')).join('');
 const user=await env.DB.prepare('SELECT u.id,u.email,u.display_name FROM darts_sessions s JOIN darts_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').bind(hash,Date.now()).first();
 if(!user)fail(401,'Your session has expired. Please sign in again.');
 const body=async()=>{const raw=await request.text();if(raw.length>160000)fail(413,'This record is too large.');try{return JSON.parse(raw);}catch{fail(400,'Invalid request.');}};
 if(path==='workspace'&&request.method==='GET'){
 const profile=await env.DB.prepare('SELECT data FROM flight_profiles WHERE user_id=?').bind(user.id).first();
 const records=await env.DB.prepare('SELECT id,data FROM flight_records WHERE user_id=? ORDER BY created_at DESC').bind(user.id).all();
 return json({user,profile:profile?JSON.parse(profile.data):null,flights:(records.results||[]).map(r=>({id:r.id,...JSON.parse(r.data)})),mapsKey:env.GOOGLE_MAPS_BROWSER_KEY||''});
 }
 if(path==='profile'&&request.method==='PUT'){
 const p=validateProfile(await body());await env.DB.prepare('INSERT INTO flight_profiles(user_id,data,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').bind(user.id,JSON.stringify(p),Date.now()).run();return json({profile:p});
 }
 if(path==='flights'&&request.method==='POST'){
 const flight=validateFlight(await body()),id=crypto.randomUUID();await env.DB.prepare('INSERT INTO flight_records(id,user_id,data,created_at,updated_at) VALUES(?,?,?,?,?)').bind(id,user.id,JSON.stringify(flight),Date.now(),Date.now()).run();return json({flight:{id,...flight}},201);
 }
 const match=path.match(/^flights\/([a-f0-9-]{36})$/);
 if(match&&['PUT','DELETE'].includes(request.method)){
 const row=await env.DB.prepare('SELECT id FROM flight_records WHERE id=? AND user_id=?').bind(match[1],user.id).first();if(!row)fail(404,'Flight not found.');
 if(request.method==='DELETE'){await env.DB.prepare('DELETE FROM flight_records WHERE id=? AND user_id=?').bind(row.id,user.id).run();return json({ok:true});}
 const flight=validateFlight(await body());await env.DB.prepare('UPDATE flight_records SET data=?,updated_at=? WHERE id=? AND user_id=?').bind(JSON.stringify(flight),Date.now(),row.id,user.id).run();return json({flight:{id:row.id,...flight}});
 }
 return json({error:'Not found.'},404);
 }catch(error){if(error.status)return json({error:error.message},error.status);console.error('Flight request failed',error.message);return json({error:'Your flight desk could not load. Check the Flight database migration and try again.'},503);}
}
