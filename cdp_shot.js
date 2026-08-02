const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
function getJson(url){return new Promise((res,rej)=>{http.get(url,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);});}
(async()=>{
  const chrome = spawn('/usr/bin/google-chrome',['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=9228','about:blank'],{stdio:'ignore'});
  await new Promise(r=>setTimeout(r,1500));
  const list = await getJson('http://localhost:9228/json');
  const target = list.find(t=>t.type==='page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id=0; const pending=new Map();
  function send(m,p){return new Promise(res=>{const i=++id;pending.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p||{}}));});}
  ws.on('message',d=>{const m=JSON.parse(d);if(m.id&&pending.has(m.id)){pending.get(m.id)(m.result);pending.delete(m.id);}});
  await new Promise(r=>ws.on('open',r));
  await send('Runtime.enable'); await send('Page.enable');
  const url='file:///home/doug/kreweweb/Krewe/frontend/history.html';
  await send('Page.navigate',{url});
  await new Promise(r=>setTimeout(r,1500));
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true,screenWidth:390,screenHeight:844});
  await new Promise(r=>setTimeout(r,500));
  async function shot(name){
    const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    if(!r||!r.data){console.log('no data for',name,JSON.stringify(r).slice(0,100));return;}
    fs.writeFileSync('/home/doug/kreweweb/Krewe/'+name,Buffer.from(r.data,'base64'));
    console.log('wrote',name);
  }
  await shot('shot_closed.png');
  const coords=await send('Runtime.evaluate',{expression:'(function(){var t=document.querySelector(".nav-toggle");var r=t.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()',returnByValue:true});
  const c=coords.result.value;
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:c.x,y:c.y,button:'left',clickCount:1});
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:c.x,y:c.y,button:'left',clickCount:1});
  await new Promise(r=>setTimeout(r,400));
  await shot('shot_open.png');
  const links=await send('Runtime.evaluate',{expression:'(function(){var out=[];document.querySelectorAll(".site-nav a").forEach(function(a){if(getComputedStyle(a).display==="none")return;var r=a.getBoundingClientRect();if(r.width===0)return;var h=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);out.push({txt:a.textContent.trim(),hitIsLink:!!(h&&(h===a||a.contains(h)))});});return out;})()',returnByValue:true});
  console.log('LINKS:', JSON.stringify(links.result.value));
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
