// What is BJ_pick actually choosing during the ride, and why?
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
    g.startRun(); g.lvIdx=7; g.loadLevel(7); g.state='play'; g.lives=99;
    const log=[]; window.__pj=false;
    for(let i=0;i<60*8;i++){
      const pl=g.player, bo=g.boss;
      let act={L:0,R:0,run:0,jump:0};
      try{act=AUTOPILOT(g,i)||act}catch(e){if(!window.__ae)window.__ae=e.message;}
      if(bo && bo.state==='ride' && i%6===0){
        const pk = BJ_pick(bo, pl, bo.rect.cx > pl.rect.cx+24 ? 1 : (bo.rect.cx < pl.rect.cx-24 ? -1 : 0));
        // score each option separately so we can see WHY
        const each=[];
        for(const d of [-1,0,1]){
          const one = (function(dir){
            const saved=BJ_pick; return null; })(d);
          each.push(d);
        }
        log.push('t='+(i/60).toFixed(2)+' px='+Math.round(pl.rect.cx)+' pies='+Math.round(pl.rect.b)+
          ' bx='+Math.round(bo.rect.cx)+' D='+Math.round(bo.rect.cx-pl.rect.cx)+
          ' elige='+pk.dir+' claro='+pk.clear.toFixed(2)+' tHit='+pk.t+
          ' act='+(act.L?'L':act.R?'R':'-')+(act.run?'+':'')+(act.jump?'J':'')+
          ' cartas='+bo.proj.length+' suelo='+(pl.onGround?'si':'no'));
      }
      IN.L=!!act.L;IN.R=!!act.R;IN.run=!!act.run;
      if(act.jump&&!window.__pj){IN.jumpBuf=BUFFER;IN.anyPress=true;}
      IN.jumpHeld=!!act.jump;window.__pj=!!act.jump;
      window.__flush(i*(1000/60));
    }
    return {log:log, apErr:window.__ae||null, err:window.__err||null};
  }, src);
  r.log.forEach(l=>console.log('  '+l));
  if(r.apErr) console.log('ERROR AP: '+r.apErr);
  if(r.err) console.log('ERROR bucle: '+r.err);
  await b.close();
})().catch(e=>{console.error('FALLO: '+e.message);process.exit(9);});
