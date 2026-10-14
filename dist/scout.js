(function(){
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const vibes=['Soft golden editorial','City-night flash','Clean coastal','Cinematic & moody'];
  const subjects=['Friends / photo dump','Outfit content','Travel video','Couple photos','Solo portraits'];
  let selection=null, places=[], active=null, generation=0, busy=false;
  const $=id=>document.getElementById(id);
  function token(id){try{return sessionStorage.getItem('scout-access-'+id)||'';}catch{return '';}}
  async function api(path,body,access){
    const res=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(access?{Authorization:'Bearer '+access}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    let data;try{data=await res.json();}catch{throw new Error('Scout Plans are still being connected. Please try again shortly.');}
    if(!res.ok)throw new Error(data.error||'Something went wrong. Please retry.');return data;
  }
  const message=text=>{if($('scoutMessage'))$('scoutMessage').textContent=text;};
  function options(list,value){return list.map(x=>'<option'+(x===value?' selected':'')+'>'+esc(x)+'</option>').join('');}
  function form(){
    let draft={};try{draft=JSON.parse(sessionStorage.getItem('scout-input')||'{}');}catch{}
    selection=null;active=null;
    return '<div class="scout-steps"><b>01 · Your shoot</b><span>02 · Preview</span><span>03 · Unlock</span></div><section class="dash-panel"><span class="eyebrow">One place. One date. A better plan.</span><h2>Make your Scout Plan.</h2><p>Find your city, choose the feeling, and tell us what you’re shooting. Preview free, then unlock the complete plan for £4.99.</p><form id="paidScoutForm" class="dash-form"><div class="dash-field dash-full"><label for="scoutSearch">City or town</label><div class="scout-search"><input id="scoutSearch" maxlength="100" placeholder="e.g. Barcelona" value="'+esc(draft.location)+'" autocomplete="off"><button class="button outline" id="searchPlaces" type="button">Search</button></div><p class="scout-help">Select a result to confirm the coordinates and local time zone. This is city-level guidance, not a survey of a specific street.</p><div id="placeResults" aria-live="polite"></div><p id="selectedPlace"></p></div><div class="dash-field"><label for="scoutDate">Shoot date</label><input type="date" required id="scoutDate" value="'+esc(draft.date||new Date(Date.now()+86400000).toISOString().slice(0,10))+'"></div><div class="dash-field"><label for="scoutVibe">Vibe</label><select id="scoutVibe">'+options(vibes,draft.vibe)+'</select></div><div class="dash-field dash-full"><label for="scoutSubject">What are you shooting?</label><select id="scoutSubject">'+options(subjects,draft.subject)+'</select></div><p class="scout-help dash-full">We check the sun’s position and available weather, then prepare tailored direction and shot prompts. Weather may be unavailable for dates further ahead.</p><button class="button dash-full" id="buildPreview" type="submit">Create my free preview ↗</button></form></section>';
  }
  function preview(row){
    const p=row.preview,refunded=row.status==='refunded';
    return '<div class="scout-steps"><span>01 · Your shoot</span><b>02 · Preview</b><span>03 · Unlock</span></div><section class="dash-panel scout-preview"><span class="eyebrow">'+esc(p.date)+' · '+esc(p.subject)+'</span><h2>'+esc(p.location)+'</h2><p>'+esc(p.vibe)+'</p><div class="scout-fact"><strong>'+(p.weatherAvailable?'Forecast available':'Sun-based plan')+'</strong><p>'+esc(p.weatherNote)+'</p></div><p>'+esc(p.scope)+'</p><div class="scout-locked"><span aria-hidden="true">◷</span><div><h3>Your shoot window is ready.</h3><p>Exact timing and tailored advice are included in the full plan.</p></div></div><ul class="price-list">'+p.includes.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul><button class="button" data-scout="checkout" '+(refunded?'disabled':'')+'>'+(refunded?'Purchase refunded':'Unlock this plan · £4.99 ↗')+'</button><p class="scout-help">One payment. No subscription. Your completed plan is prepared before checkout. Save the access link after payment to reopen it on another device.</p><a href="#dashboard/new-scout">Change the brief →</a></section>';
  }
  function full(row){
    const p=row.plan,f=p.facts,a=p.advice,w=f.conditions;
    return '<section class="dash-panel"><span class="eyebrow">Unlocked Scout Plan · '+esc(p.input.date)+'</span><h2>'+esc(p.input.place.name)+'</h2><p>'+esc(a.title)+'</p><div class="scout-window"><span>Arrive '+esc(f.window.arrivalLocal)+'</span><strong>'+esc(f.window.startLocal)+'–'+esc(f.window.endLocal)+'</strong><span>'+esc(f.timezone)+' · estimated shoot window</span></div><p>'+esc(a.summary)+'</p><div class="scout-facts"><div><b>Sun direction</b><p>'+esc(f.sun.direction)+' · '+esc(f.sun.azimuthDegrees)+'° compass bearing</p></div><div><b>Sun height</b><p>'+esc(f.sun.altitudeDegrees)+'° above the horizon</p></div><div><b>Weather</b><p>'+(w?esc(w.temperatureC??'—')+'°C · rain chance '+esc(w.rainProbability??'—')+'% · cloud '+esc(w.cloudPercent??'—')+'% · wind '+esc(w.windKmh??'—')+' km/h':'No forecast for this date. Weather advice is conditional.')+'</p></div></div><h3>Where to stand</h3><p>'+esc(a.direction)+'</p><div class="scout-shot-grid">'+a.shots.map((s,i)=>'<article><span class="eyebrow">Shot 0'+(i+1)+'</span><h3>'+esc(s.title)+'</h3><p>'+esc(s.prompt)+'</p></article>').join('')+'</div><h3>Your backup move</h3><p>'+esc(a.backup)+'</p><h3>Bring along</h3><ul>'+a.packing.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul><p>'+esc(a.caution)+'</p><details><summary>Data, timing and limitations</summary><p>Prepared '+esc(new Date(f.calculatedAt).toLocaleString())+'. Forecast is a snapshot, not a live guarantee.</p><ul>'+f.limitations.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul>'+p.sources.map(s=>'<p><a href="'+esc(s.url)+'" target="_blank" rel="noopener noreferrer">'+esc(s.label)+'</a></p>').join('')+'</details><div class="dash-actions"><button class="button" data-scout="download">Download full plan</button><button class="button outline" data-scout="recovery">Save access link</button><a class="button outline" href="#dashboard/new-scout">Plan another shoot</a></div><div id="recoveryResult"></div><p class="scout-help">Keep your downloaded plan and access link. Anyone with the access link can view this plan.</p></section>';
  }
  async function render(){
    const host=$('scoutApp');if(!host)return;
    const run=++generation;busy=false;
    host.innerHTML='<p id="scoutMessage" role="status">Loading Scout Plans…</p><div id="scoutContent"></div>';
    try{
      const config=await api('status');if(run!==generation)return;
      const pieces=location.hash.split('/'),id=pieces[2];
      if(!config.ready&&pieces[1]==='new-scout'){message('Scout Plans are not open yet. Payment and AI services are being connected. You can still save a shoot draft from Home.');$('scoutContent').innerHTML='<a class="button" href="#dashboard">Save a draft instead</a>';return;}
      if(pieces[1]==='new-scout'){$('scoutContent').innerHTML=form();message(config.paymentsMode==='test'?'Test checkout mode — no real money is charged.':'');return;}
      if(!id||!/^[a-f0-9-]{36}$/.test(id))throw new Error('Plan not found.');
      const fragment=pieces[3];if(fragment?.startsWith('access=')){const access=fragment.slice(7);sessionStorage.setItem('scout-access-'+id,access);history.replaceState(null,'',location.pathname+'#dashboard/scout/'+id);}
      const query=new URLSearchParams(location.search);
      if(query.get('checkout')==='success'&&query.get('session_id')){
        message('Confirming your payment…');await api('plans/'+id+'/verify',{sessionId:query.get('session_id')},token(id));
        history.replaceState(null,'',location.pathname+'#dashboard/scout/'+id);
      }
      active=await api('plans/'+id,undefined,token(id));if(run!==generation)return;
      $('scoutContent').innerHTML=active.status==='paid'?full(active):preview(active);
      message(query.get('checkout')==='cancelled'?'Checkout cancelled. You can return to payment whenever you’re ready.':query.get('checkout')==='success'&&active.status!=='paid'?'Payment is still processing. Refresh in a moment; do not pay again.':config.paymentsMode==='test'?'Test mode — this is not a live purchase.':'');
    }catch(e){if(run===generation)message(e.message);}
  }
  async function search(){
    const q=$('scoutSearch').value.trim();if(q.length<2){message('Enter at least two letters of the city or town.');return;}
    const button=$('searchPlaces');button.disabled=true;message('Finding your location…');selection=null;
    try{const data=await api('locations?q='+encodeURIComponent(q));places=data.places;$('placeResults').innerHTML=places.map((p,i)=>'<button class="place-choice" type="button" data-place="'+i+'"><strong>'+esc(p.name)+'</strong><span>'+p.latitude.toFixed(3)+', '+p.longitude.toFixed(3)+' · '+esc(p.timezone)+'</span></button>').join('');message(places.length?'Choose your location below.':'No matches. Try the nearest city or town.');}catch(e){message(e.message);}finally{button.disabled=false;}
  }
  document.addEventListener('input',e=>{if(e.target.id==='scoutSearch'){selection=null;if($('selectedPlace'))$('selectedPlace').textContent='';}});
  document.addEventListener('click',async e=>{
    if(e.target.closest('#searchPlaces')){await search();return;}
    const choice=e.target.closest('[data-place]');if(choice){selection=places[Number(choice.dataset.place)];$('selectedPlace').textContent='Selected: '+selection.name;$('placeResults').innerHTML='';message('Location confirmed.');return;}
    const action=e.target.closest('[data-scout]');if(!action||!active||busy)return;busy=true;action.disabled=true;
    try{
      if(action.dataset.scout==='checkout'){message('Opening secure checkout…');const result=await api('plans/'+active.id+'/checkout',{},token(active.id));if(result.paid){await render();}else{const target=new URL(result.url);if(target.hostname!=='checkout.stripe.com')throw new Error('Unexpected checkout destination.');location.assign(target.href);}}
      if(action.dataset.scout==='download'){const p=active.plan,f=p.facts,a=p.advice;const text=['BOPLO SCOUT PLAN',p.input.place.name,p.input.date+' · '+p.input.vibe+' · '+p.input.subject,'',a.title,a.summary,'','Arrive '+f.window.arrivalLocal+' · Shoot '+f.window.startLocal+'–'+f.window.endLocal+' ('+f.timezone+')','Sun: '+f.sun.direction+' '+f.sun.azimuthDegrees+'° / height '+f.sun.altitudeDegrees+'°','Weather: '+(f.conditions?JSON.stringify(f.conditions):'Unavailable'),'',a.direction,...a.shots.map((s,i)=>'\n'+(i+1)+'. '+s.title+'\n'+s.prompt),'','Backup: '+a.backup,'Bring: '+a.packing.join(', '),a.caution,'',...f.limitations,...p.sources.map(s=>s.label+': '+s.url)].join('\n');const link=document.createElement('a'),url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));link.href=url;link.download='boplo-scout-plan.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message('Plan downloaded.');}
      if(action.dataset.scout==='recovery'){const r=await api('plans/'+active.id+'/recovery',{},token(active.id));sessionStorage.setItem('scout-access-'+active.id,r.token);const link=location.origin+location.pathname+'#dashboard/scout/'+active.id+'/access='+r.token;$('recoveryResult').innerHTML='<label for="accessLink">Your private access link — copy and keep it</label><input id="accessLink" readonly value="'+esc(link)+'"><p>Creating a new access link replaces the previous one.</p>';$('accessLink').select();message('Access link ready to copy.');}
    }catch(err){message(err.message);}finally{busy=false;action.disabled=false;}
  });
  document.addEventListener('submit',async e=>{
    if(e.target.id!=='paidScoutForm')return;e.preventDefault();if(busy)return;
    if(!selection){message('Search and select a location first.');return;}
    const input={placeToken:selection.token,date:$('scoutDate').value,vibe:$('scoutVibe').value,subject:$('scoutSubject').value};
    busy=true;$('buildPreview').disabled=true;message('Checking the light, forecast and your shoot brief. This may take up to a minute…');
    try{const r=await api('preview',input);location.hash='dashboard/scout/'+r.id;}catch(err){message(err.message);}finally{busy=false;if($('buildPreview'))$('buildPreview').disabled=false;}
  });
  async function decorate(){
    if(document.body.classList.contains('app-mode')){
      const main=document.querySelector('.dash-main');if(main&&!main.querySelector('.new-paid-plan')){const a=document.createElement('a');a.className='button new-paid-plan';a.href='#dashboard/new-scout';a.textContent='Create a Scout Plan ↗';main.querySelector('.dash-top')?.after(a);}
      if(location.hash==='#dashboard/plans'){
        const list=document.createElement('section');list.className='dash-panel';list.innerHTML='<h2>Your Scout Plans</h2><p>Loading…</p>';main.prepend(list);
        try{const r=await api('plans');list.innerHTML='<h2>Your Scout Plans</h2>'+(r.plans.length?r.plans.map(p=>'<article class="dash-item"><div><h3>'+esc(p.preview.location)+'</h3><p>'+esc(p.preview.date)+' · '+esc(p.status)+'</p></div><a class="button outline" href="#dashboard/scout/'+p.id+'">Open plan →</a></article>').join(''):'<p>Your previews and purchased plans will appear here.</p>');}catch{list.innerHTML='<h2>Your Scout Plans</h2><p>Scout Plan services are being connected. Your browser drafts are shown below.</p>';}
      }
    }
    await render();
  }
  document.querySelector('#scoutForm')?.addEventListener('submit',function(e){e.preventDefault();try{sessionStorage.setItem('scout-input',JSON.stringify({location:$('location').value,date:$('date').value,vibe:vibes[$('vibe').selectedIndex],subject:$('shoot').value}));}catch{}location.hash='dashboard/new-scout';});
  if($('date'))$('date').value=new Date(Date.now()+86400000).toISOString().slice(0,10);
  if($('year'))$('year').textContent=new Date().getFullYear();
  window.addEventListener('hashchange',decorate);decorate();
})();
