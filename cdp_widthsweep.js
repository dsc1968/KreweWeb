const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');
function getJson(url){return new Promise((res,rej)=>{http.get(url,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);});}
(async()=>{
  const chrome = spawn('/usr/bin/google-chrome',['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=9225','about:blank'],{stdio:'ignore'});
  await new Promise(r=>setTimeout(r,1500));
  const list = await getJson('http://localhost:9225/json');
  const target = list.find(t=>t.type==='page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id=0; const pending=new Map();
  function send(m,p){return new Promise(res=>{const i=++id;pending.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p||{}}));});}
  ws.on('message',d=>{const m=JSON.parse(d);if(m.id&&pending.has(m.id)){pending.get(m.id)(m.result);pending.delete(m.id);}});
  await new Promise(r=>ws.on('open',r));
  await send('Runtime.enable');
  async function ev(e){const r=await send('Runtime.evaluate',{expression:e,returnByValue:true});return r.result&&r.result.value;}

  async function testAtWidth(url, w){
    await send('Page.navigate',{url});
    await new Promise(r=>setTimeout(r,1200));
    await send('Emulation.setDeviceMetricsOverride',{width:w,height:844,deviceScaleFactor:2,mobile:true,screenWidth:w,screenHeight:844});
    await new Promise(r=>setTimeout(r,400));
    return await ev(`(function(){
      var de=document.documentElement;
      var inner=window.innerWidth;
      var t=document.querySelector('.nav-toggle');
      var tr=t?t.getBoundingClientRect():null;
      return {
        inner:inner,
        ovf: de.scrollWidth-de.clientWidth,
        tVis: t?getComputedStyle(t).display!=='none':false,
        tOn: tr?(tr.left>=0 && tr.right<=inner):false,
        tRight: tr?Math.round(tr.right):-1
      };
    })()`);
  }
  const url='file:///home/doug/kreweweb/Krewe/frontend/history.html';
  for (const w of [320,360,375,390,414,480,600,768,900,1000]) {
    const r=await testAtWidth(url,w);
    console.log('w='+w, JSON.stringify(r));
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
