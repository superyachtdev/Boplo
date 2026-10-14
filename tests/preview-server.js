// Local UI fixture only. Never deployed: simulated providers, no real payments.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {onRequest} from '../functions/api/[[path]].js';
import {environment,providers} from './helpers.js';
const env=environment(),mock=providers();globalThis.fetch=mock.fetch;
http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost:4173');
  if(url.pathname.startsWith('/api/')){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const request=new Request(url,{method:req.method,headers:req.headers,body:req.method==='POST'?Buffer.concat(chunks):undefined});
   const result=await onRequest({request,env,waitUntil:p=>p.catch(()=>{})});
   if(url.pathname.endsWith('/checkout')&&result.ok){
    const s=[...mock.sessions.values()].at(-1);if(s){s.status='complete';s.payment_status='paid';
    const verify=new Request(url.href.replace(/checkout$/,'verify'),{method:'POST',headers:req.headers,body:JSON.stringify({sessionId:s.id})});
    const verified=await onRequest({request:verify,env,waitUntil:p=>p});res.writeHead(verified.status,Object.fromEntries(verified.headers));res.end(await verified.text());return;}
   }
   res.writeHead(result.status,Object.fromEntries(result.headers));res.end(await result.text());return;
  }
  const allowed={'/':'index.html','/scout.js':'scout.js','/scout.css':'scout.css','/boplo-mark.svg':'boplo-mark.svg'};
  if(!allowed[url.pathname]){res.writeHead(404);res.end();return;}
  const file=allowed[url.pathname],data=await readFile(new URL('../dist/'+file,import.meta.url));res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});res.end(data);
 }catch(e){res.writeHead(500);res.end(e.message);}
}).listen(4173,'127.0.0.1',()=>console.log('UI fixtures: http://localhost:4173/#dashboard/new-scout'));
