const { execSync } = require('child_process'); const fs=require('fs'); const path=require('path');
const { chromium } = require(path.join(execSync('npm root -g').toString().trim(),'playwright'));
(async()=>{
  const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1000,height:640}});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.addInitScript(()=>{window.__capture=true;window.__q=[];
    window.requestAnimationFrame=c=>{window.__q.push(c);return 1;};
    window.cancelAnimationFrame=()=>{};
    window.__flush=ts=>{const q=window.__q;window.__q=[];for(const c of q){try{c(ts)}catch(e){if(!window.__err)window.__err=e.message;}}};});
  await p.goto('file://'+path.join(__dirname,'..','game.html'),{waitUntil:'load'});
  await p.waitForFunction(()=>!!window.__game,null,{timeout:25000});
  const src = ['aprollout.js','autopilot.js','policy-penguin.js','policy-joker.js']
    .map(f=>fs.readFileSync(path.join(__dirname,f),'utf8')).join('\n;\n');
  const r = await p.evaluate(src0=>{
    (0,eval)(src0);
    const g=window.__game; g.draw=function(){};
    g.startRun(); g.lvIdx=7; g.loadLevel(7); g.state='play'; g.lives=99;
    const seen=[]; let prev=''; let prevBoss=g.boss; let reloads=0;
    // A level reload builds a NEW boss in 'intro'. Without flagging that, a
    // respawn reads exactly like the state machine looping back on itself --
    // which is what it looked like for a while.
    const realLoad = g.loadLevel.bind(g);
    g.loadLevel = function(i){ reloads++; seen.push('  *** RECARGA DE NIVEL ***'); return realLoad(i); };
    window.__pj=false;
    for(let i=0;i<60*60;i++){
      let act={L:0,R:0,run:0,jump:0};
      try{act=AUTOPILOT(g,i)||act}catch(e){if(!window.__ae)window.__ae=e.message;}
      IN.L=!!act.L;IN.R=!!act.R;IN.run=!!act.run;
      if(act.jump&&!window.__pj){IN.jumpBuf=BUFFER;IN.anyPress=true;}
      IN.jumpHeld=!!act.jump;window.__pj=!!act.jump;
      window.__flush(i*(1000/60));
      const bo=g.boss; if(!bo) break;
      if(bo!==prevBoss){ seen.push((i/60).toFixed(2)+'  (jefe nuevo)'); prevBoss=bo; prev=''; }
      if(bo.state!==prev){ seen.push((i/60).toFixed(2)+' '+prev+'->'+bo.state+' t='+bo.t.toFixed(2)+' hp'+bo.hp+' pol='+(typeof BJ_why!=='undefined'?BJ_why:'-')); prev=bo.state; }
      if(bo.defeated) break;
    }
    const bo=g.boss;
    return {seen:seen.slice(0,30), recargas:reloads, apErr:window.__ae||null, estado:bo.state, t:+bo.t.toFixed(2), hp:bo.hp,
            lastDt:g.lastDt, err:window.__err||null};
  }, src);
  console.log('transiciones:'); r.seen.forEach(s=>console.log('  '+s));
  console.log('recargas de nivel: '+r.recargas+(r.apErr?'  ERROR AP: '+r.apErr:''));
  console.log('final: estado='+r.estado+' t='+r.t+' hp='+r.hp+' lastDt='+r.lastDt);
  if(r.err) console.log('ERROR bucle: '+r.err);
  if(errs.length) console.log('errores: '+errs.slice(0,3).join(' | '));
  await b.close();
})().catch(e=>{console.error('FALLO: '+e.message);process.exit(9);});
