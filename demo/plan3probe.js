// Does a single trial of plan3 actually advance the game? (the scan finished
// 8640 trials in 4s, which is not physically possible)
const { execSync } = require('child_process'); const path=require('path');
const { chromium } = require(path.join(execSync('npm root -g').toString().trim(),'playwright'));
(async()=>{
  const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1000,height:640}});
  await p.addInitScript(()=>{window.__capture=true;window.__q=[];
    window.requestAnimationFrame=c=>{window.__q.push(c);return 1;};
    window.cancelAnimationFrame=()=>{};
    window.__flush=ts=>{const q=window.__q;window.__q=[];for(const c of q){try{c(ts)}catch(e){if(!window.__err)window.__err=e.message;}}};});
  await p.goto('file://'+path.join(__dirname,'..','game.html'),{waitUntil:'load'});
  await p.waitForFunction(()=>!!window.__game,null,{timeout:25000});
  const r = await p.evaluate(()=>{
    const g=window.__game; g.draw=function(){};
    const out=[];
    function setup(){
      g.startRun(); g.lvIdx=7; g.loadLevel(7); g.state='play'; g.lives=9999;
      const bo=g.boss, pl=g.player;
      bo.hp=1; bo.phase=3; bo.introT=99; bo.rect.x=114; bo.rect.y=288; bo.setState('hurt');
      pl.rect.x=300-pl.rect.w/2; pl.rect.y=480-pl.rect.h; pl.vx=0; pl.vy=0;
      return {bo,pl};
    }
    for (let trial=0; trial<3; trial++) {
      const {bo,pl}=setup();
      out.push('--- ensayo '+trial+' --- gstate='+g.state+' q='+window.__q.length+' last='+Math.round(g.last||0));
      const base = trial*1000;                 // ts keeps GROWING between trials
      for(let i=0;i<60*3;i++){
        window.__flush(base + i*(1000/60));
        if(i%45===0) out.push('  i='+i+' estado='+bo.state+' t='+bo.t.toFixed(2)+' bx='+Math.round(bo.rect.cx)+
          ' q='+window.__q.length+' g='+g.state+' err='+(window.__err||'-'));
      }
    }
    // and the BROKEN way: ts restarting from 0 each trial
    for (let trial=0; trial<2; trial++) {
      const {bo}=setup();
      out.push('--- (ts reinicia en 0) ensayo '+trial+' last='+Math.round(g.last||0)+' q='+window.__q.length);
      for(let i=0;i<60*3;i++){
        window.__flush(i*(1000/60));
        if(i%45===0) out.push('  i='+i+' estado='+bo.state+' t='+bo.t.toFixed(2)+' q='+window.__q.length);
      }
    }
    return {out, err: window.__err||null};
  });
  console.log(r.out.join('\n')); if(r.err) console.log('ERROR: '+r.err);
  await b.close();
})();
