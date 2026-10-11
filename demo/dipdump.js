// Every dip, frame by frame: were we lined up, did we jump, how high did we get?
const { execSync } = require('child_process'); const fs=require('fs'); const path=require('path');
const { chromium } = require(path.join(execSync('npm root -g').toString().trim(),'playwright'));
(async()=>{
  const src = ['aprollout.js','autopilot.js','policy-penguin.js','policy-joker.js']
    .map(f=>fs.readFileSync(path.join(__dirname,f),'utf8')).join('\n;\n');
  const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1000,height:640}});
  await p.addInitScript(()=>{window.__capture=true;window.__q=[];
    window.requestAnimationFrame=c=>{window.__q.push(c);return 1;};
    window.cancelAnimationFrame=()=>{};
    window.__flush=ts=>{const q=window.__q;window.__q=[];for(const c of q){try{c(ts)}catch(e){if(!window.__err)window.__err=e.message;}}};});
  await p.goto('file://'+path.join(__dirname,'..','game.html'),{waitUntil:'load'});
  await p.waitForFunction(()=>!!window.__game,null,{timeout:25000});
  const r = await p.evaluate(src0=>{
    (0,eval)(src0);
    const g=window.__game; g.draw=function(){};
    g.startRun(); g.lvIdx=7; g.loadLevel(7); g.state='play'; g.lives=9999;
    const dips=[]; let cur=null; let prev=''; window.__pj=false;
    for(let i=0;i<60*70;i++){
      const pl=g.player, bo=g.boss;
      let act={L:0,R:0,run:0,jump:0};
      try{act=AUTOPILOT(g,i)||act}catch(e){if(!window.__ae)window.__ae=e.message;}
      if(bo){
        if(bo.state==='taunt' && prev!=='taunt'){ cur={t0:(i/60).toFixed(2), hp0:bo.hp, f:[], jumped:false, minAbs:9999, apex:9999}; dips.push(cur); }
        if(bo.state==='taunt' && cur){
          const dx=bo.rect.cx-pl.rect.cx;
          if(Math.abs(dx)<cur.minAbs) cur.minAbs=Math.abs(dx);
          if(pl.rect.b<cur.apex) cur.apex=Math.round(pl.rect.b);
          if(act.jump) cur.jumped=true;
          if(cur.f.length<14 && i%3===0) cur.f.push(Math.round(dx)+'/'+Math.round(bo.rect.y)+'/'+Math.round(pl.rect.b)+(act.jump?'J':''));
        }
        if(prev==='taunt' && bo.state!=='taunt' && cur){ cur.hp1=bo.hp; cur.salida=bo.state; cur=null; }
        prev=bo.state;
      }
      IN.L=!!act.L;IN.R=!!act.R;IN.run=!!act.run;
      if(act.jump&&!window.__pj){IN.jumpBuf=BUFFER;IN.anyPress=true;}
      IN.jumpHeld=!!act.jump;window.__pj=!!act.jump;
      window.__flush(i*(1000/60));
    }
    return {dips:dips.slice(0,8), apErr:window.__ae||null};
  }, src);
  for(const d of r.dips){
    console.log('dip t='+d.t0+' hp'+d.hp0+'->'+(d.hp1===undefined?'?':d.hp1)+
      ' salio='+d.salida+' saltó='+(d.jumped?'si':'NO')+
      ' |dx|min='+d.minAbs+' piesMin='+d.apex);
    console.log('    dx/jefeY/pies: '+d.f.join('  '));
  }
  if(r.apErr) console.log('ERROR AP: '+r.apErr);
  await b.close();
})().catch(e=>{console.error('FALLO: '+e.message);process.exit(9);});
