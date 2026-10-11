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
    const log=[]; window.__pj=false;
    for(let i=0;i<60*26;i++){
      const pl=g.player, bo=g.boss;
      let act={L:0,R:0,run:0,jump:0};
      try{act=AUTOPILOT(g,i)||act}catch(e){if(!window.__ae)window.__ae=e.message;}
      if(bo && bo.phase===2 && i%5===0){
        log.push('t='+(i/60).toFixed(2)+' px='+Math.round(pl.rect.cx)+' pies='+Math.round(pl.rect.b)+
          ' plat='+BJ_onPlat(pl)+' tp='+bo.tpIndex+' '+bo.state.padEnd(8)+
          ' bx='+Math.round(bo.rect.cx)+' gas='+Math.round(bo.gasY)+
          ' pol='+BJ_why+' act='+(act.L?'L':act.R?'R':'-')+(act.jump?'J':''));
      }
      IN.L=!!act.L;IN.R=!!act.R;IN.run=!!act.run;
      if(act.jump&&!window.__pj){IN.jumpBuf=BUFFER;IN.anyPress=true;}
      IN.jumpHeld=!!act.jump;window.__pj=!!act.jump;
      window.__flush(i*(1000/60));
    }
    return {log:log, apErr:window.__ae||null};
  }, src);
  r.log.forEach(l=>console.log('  '+l));
  if(r.apErr) console.log('ERROR AP: '+r.apErr);
  await b.close();
})().catch(e=>{console.error('FALLO: '+e.message);process.exit(9);});
