const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');
function getJson(url){return new Promise((res,rej)=>{http.get(url,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);});}
(async()=>{
  const chrome = spawn('/usr/bin/google-chrome',['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=9226','about:blank'],{stdio:'ignore'});
  await new Promise(r=>setTimeout(r,1500));
  const list = await getJson('http://localhost:9226/json');
  const target = list.find(t=>t.type==='page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id=0; const pending=new Map();
  function send(m,p){return new Promise(res=>{const i=++id;pending.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p||{}}));});}
  ws.on('message',d=>{const m=JSON.parse(d);if(m.id&&pending.has(m.id)){pending.get(m.id)(m.result);pending.delete(m.id);}});
  await new Promise(r=>ws.on('open',r));
  await send('Runtime.enable');
  await send('Log.enable');
  ws.on('message',(d)=>{const m=JSON.parse(d); if(m.method==='Log.entryAdded'){const e=m.params.entry; if(e.level==='error'||e.level==='warning'){console.log('['+e.level+'] '+e.text+' @ '+(e.url||'')+':'+(e.lineNumber||''));}}});
  ws.on('message',(d)=>{const m=JSON.parse(d); if(m.method==='Runtime.exceptionThrown'){console.log('[EXCEPTION] '+JSON.stringify(m.params.exceptionDetails.exception&&m.params.exceptionDetails.exception.description||m.params.exceptionDetails.text));}});

  for (const name of ['history.html','index.html']) {
    console.log('===== LOADING '+name+' =====');
    await send('Page.navigate',{url:'file:///home/doug/kreweweb/Krewe/frontend/'+name});
    await new Promise(r=>setTimeout(r,2000));
    // check toggle presence
    const r=await send('Runtime.evaluate',{expression:'(function(){var t=document.querySelector(".nav-toggle");var nav=document.querySelector(".site-nav");return {toggle:!!t, nav:!!nav, version: window.KREWE_EDITOR_VERSION};})()',returnByValue:true});
    console.log('STATE:', JSON.stringify(r.result&&r.result.value));
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
