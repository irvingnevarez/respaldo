// Which standoff distance from the Joker is actually survivable in phase 1?
//
// The player is pinned at (boss.cx - D) every frame -- no policy, no movement
// error -- and hits are counted over 25s of ride. This replaces three rounds of
// reasoning about card arcs with a table.
const { execSync } = require('child_process'); const fs=require('fs'); const path=require('path');
const { chromium } = require(path.join(execSync('npm root -g').toString().trim(),'playwright'));
(async()=>{
  const b=await chromium.launch();
  const rows=[];
  for (const spec of [[0,'suelo'],[60,'suelo'],[120,'suelo'],[180,'suelo'],[240,'suelo'],
                      [300,'suelo'],[360,'suelo'],[420,'suelo'],[0,'plat'],[120,'plat'],[240,'plat']]) {
    const [D, where] = spec;
    const p=await b.newPage({viewport:{width:1000,height:640}});
    await p.addInitScript(()=>{window.__capture=true;window.__q=[];
      window.requestAnimationFrame=c=>{window.__q.push(c);return 1;};
      window.cancelAnimationFrame=()=>{};
      window.__flush=ts=>{const q=window.__q;window.__q=[];for(const c of q){try{c(ts)}catch(e){if(!window.__err)window.__err=e.message;}}};});
    await p.goto('file://'+path.join(__dirname,'..','game.html'),{waitUntil:'load'});
    await p.waitForFunction(()=>!!window.__game,null,{timeout:25000});
    const r = await p.evaluate(a=>{
      const [D, where] = a;
      const g=window.__game; g.draw=function(){};
      g.startRun(); g.lvIdx=7; g.loadLevel(7); g.state='play'; g.lives=9999;
      let hits=0, taunts=0, prev='';
      const pl=g.player;
      const realHurt=pl.hurt.bind(pl);
      pl.hurt=function(gg){ hits++; return realHurt(gg); };
      const footY = where==='plat' ? 384 : 480;
      for(let i=0;i<60*25;i++){
        const bo=g.boss;
        if(bo && bo.state!=='intro'){
          // pin: position and zero velocity, every frame
          pl.rect.x = Math.max(40, Math.min(880, bo.rect.cx - D)) - pl.rect.w/2;
          pl.rect.y = footY - pl.rect.h;
          pl.vx=0; pl.vy=0;
        }
        window.__flush(i*(1000/60));
        const bo2=g.boss;
        if(bo2 && bo2.state!==prev){ if(bo2.state==='taunt') taunts++; prev=bo2.state; }
      }
      return {hits, taunts};
    }, [D, where]);
    rows.push({D, where, hits:r.hits, taunts:r.taunts});
    console.log('  D='+String(D).padStart(4)+'  '+where.padEnd(6)+'  golpes='+String(r.hits).padStart(3)+'  dips='+r.taunts);
    await p.close();
  }
  await b.close();
})().catch(e=>{console.error('FALLO: '+e.message);process.exit(9);});
