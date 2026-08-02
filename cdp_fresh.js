const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
function getJson(url){return new Promise((res,rej)=>{http.get(url,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);});}
(async()=>{
  const chrome = spawn('/usr/bin/google-chrome',['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=9229','about:blank'],{stdio:'ignore'});
  await new Promise(r=>setTimeout(r,1500));
  const list = await getJson('http://localhost:9229/json');
  const target = list.find(t=>t.type==='page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id=0; const pending=new Map();
  function send(m,p){return new Promise(res=>{const i=++id;pending.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p||{}}));});}
  ws.on('message',d=>{const m=JSON.parse(d);if(m.id&&pending.has(m.id)){pending.get(m.id)(m.result);pending.delete(m.id);}});
  await new Promise(r=>ws.on('open',r));
  await send('Runtime.enable'); await send('Page.enable');
  // set mobile viewport BEFORE navigating to history
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true,screenWidth:390,screenHeight:844});
  const url='file:///home/doug/kreweweb/Krewe/frontend/history.html';
  await send('Page.navigate',{url});
  await new Promise(r=>setTimeout(r,1800));
  const info=await send('Runtime.evaluate',{expression:`(function(){
    var t=document.querySelector('.nav-toggle'); var tr=t?t.getBoundingClientRect():null;
    var de=document.documentElement;
    return {toggle:!!t, disp:t?getComputedStyle(t).display:'n/a', onScreen: tr?(tr.left>=0&&tr.right<=window.innerWidth):false,
      toggleRight: tr?Math.round(tr.right):-1, inner: window.innerWidth, ovf: de.scrollWidth-de.clientWidth,
      navOpen: document.querySelector('.site-nav').classList.contains('is-open')};
  })()`,returnByValue:true});
  console.log('FRESH LOAD:', JSON.stringify(info.result.value));
  // click and recheck
  const c=await send('Runtime.evaluate',{expression:`(function(){var t=document.querySelector('.nav-toggle');var r=t.getBoundingClientRect();t.click();var n=document.querySelector('.site-nav');return {open:n.classList.contains('is-open'),disp:getComputedStyle(n).display};})()`,returnByValue:true});
  console.log('AFTER CLICK:', JSON.stringify(c.result.value));
  const r2=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  if(r2&&r2.data){const b=Buffer.from(r2.data,'base64');fs.writeFileSync('/home/doug/kreweweb/Krewe/shot_fresh.png',b);console.log('shot bytes',b.length);}
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
