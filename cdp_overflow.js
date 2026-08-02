const { spawn } = require('child_process');
const http = require('http');
const WebSocket = require('ws');
function getJson(url){return new Promise((res,rej)=>{http.get(url,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)));}).on('error',rej);});}
(async()=>{
  const chrome = spawn('/usr/bin/google-chrome',['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=9223','--window-size=390,844','about:blank'],{stdio:'ignore'});
  await new Promise(r=>setTimeout(r,1500));
  const list = await getJson('http://localhost:9223/json');
  const target = list.find(t=>t.type==='page');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id=0; const pending=new Map();
  function send(m,p){return new Promise(res=>{const i=++id;pending.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p||{}}));});}
  ws.on('message',d=>{const m=JSON.parse(d);if(m.id&&pending.has(m.id)){pending.get(m.id)(m.result);pending.delete(m.id);}});
  await new Promise(r=>ws.on('open',r));
  await send('Runtime.enable');
  async function ev(e){const r=await send('Runtime.evaluate',{expression:e,returnByValue:true});return r.result&&r.result.value;}

  async function testPage(url){
    await send('Page.navigate',{url});
    await new Promise(r=>setTimeout(r,1500));
    return await ev(`(function(){
      var de=document.documentElement;
      var inner=window.innerWidth;
      var wide=[];
      document.querySelectorAll('*').forEach(function(el){
        var r=el.getBoundingClientRect();
        if(r.right>inner+1){ wide.push({tag:el.tagName,cls:el.className&&el.className.toString().slice(0,40),right:Math.round(r.right),w:Math.round(r.width)}); }
      });
      wide.sort(function(a,b){return b.right-a.right;});
      return {
        innerWidth:inner,
        scrollWidth:de.scrollWidth,
        clientWidth:de.clientWidth,
        overflowX: de.scrollWidth - de.clientWidth,
        topWide: wide.slice(0,8)
      };
    })()`);
  }
  for (const name of ['history.html','index.html','events.html','contact.html']) {
    const url='file:///home/doug/kreweweb/Krewe/frontend/'+name;
    const r=await testPage(url);
    console.log(name, JSON.stringify(r));
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
