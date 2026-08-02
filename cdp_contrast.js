const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');
function getJson(url){return new Promise((res,rej)=>{http.get(url,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);});}
(async()=>{
  const chrome = spawn('/usr/bin/google-chrome',['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=9231','about:blank'],{stdio:'ignore'});
  await new Promise(r=>setTimeout(r,1500));
  const list = await getJson('http://localhost:9231/json');
  const target = list.find(t=>t.type==='page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id=0; const pending=new Map();
  function send(m,p){return new Promise(res=>{const i=++id;pending.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p||{}}));});}
  ws.on('message',d=>{const m=JSON.parse(d);if(m.id&&pending.has(m.id)){pending.get(m.id)(m.result);pending.delete(m.id);}});
  await new Promise(r=>ws.on('open',r));
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true,screenWidth:390,screenHeight:844});
  await send('Page.navigate',{url:'file:///home/doug/kreweweb/Krewe/frontend/history.html'});
  await new Promise(r=>setTimeout(r,1800));
  const r=await send('Runtime.evaluate',{expression:`(function(){
    function cs(el,prop){return el?getComputedStyle(el)[prop]:'n/a';}
    var header=document.querySelector('.site-header');
    var toggle=document.querySelector('.nav-toggle');
    var link=document.querySelector('.site-nav a');
    var txt=cs(toggle,'color'), bg=cs(header,'backgroundColor');
    // rough luminance contrast
    function lum(rgb){var m=rgb.match(/\\d+/g).map(Number);return (0.2126*m[0]+0.7152*m[1]+0.0722*m[2])/255;}
    var tl=lum(txt), bl=lum(bg);
    var contrast=Math.max(tl,bl)/Math.min(tl,bl);
    return {toggleColor:txt, headerBg:bg, linkColor:cs(link,'color'), contrastRatio:Math.round(contrast*100)/100, pagePath: location.pathname};
  })()`,returnByValue:true});
  console.log('HISTORY MOBILE:', JSON.stringify(r.result.value,null,2));
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
