// Which standoff survives PHASE 3? Same method that settled phase 1: pin the
// player at a fixed distance from him and count hits, no policy involved.
const { execSync } = require('child_process'); const fs=require('fs'); const path=require('path');
const { chromium } = require(path.join(execSync('npm root -g').toString().trim(),'playwright'));
(async()=>{
  const b=await chromium.launch();
  for (const spec of [[176,384,'cubierta izq'],[240,384,'cubierta izq der'],[496,320,'cubierta centro'],[784,384,'cubierta der'],[176,480,'suelo bajo cubierta'],[336,480,'suelo hueco']]) {
    const [PX, FY, LBL] = spec;
    const p=await b.newPage({viewport:{width:1000,height:640}});
    await p.addInitScript(()=>{window.__capture=true;window.__q=[];
      window.requestAnimationFrame=c=>{window.__q.push(c);return 1;};
      window.cancelAnimationFrame=()=>{};
      window.__flush=ts=>{const q=window.__q;window.__q=[];for(const c of q){try{c(ts)}catch(e){if(!window.__err)window.__err=e.message;}}};});
    await p.goto('file://'+path.join(__dirname,'..','game.html'),{waitUntil:'load'});
    await p.waitForFunction(()=>!!window.__game,null,{timeout:25000});
    const r = await p.evaluate(a=>{
      const [PX, FY] = a;
      const g=window.__game; g.draw=function(){};
      g.startRun(); g.lvIdx=7; g.loadLevel(7); g.state='play'; g.lives=9999;
      const bo=g.boss; bo.hp=1; bo.phase=3; bo.setState('ground'); bo.introT=99;
      let hits=0, throws=0, prev='';
      const pl=g.player;
      const realHurt=pl.hurt.bind(pl);
      pl.hurt=function(gg){ hits++; return realHurt(gg); };
      for(let i=0;i<60*25;i++){
        // pin on the player's RIGHT at distance D, feet on the floor
        pl.rect.x = PX - pl.rect.w/2;
        pl.rect.y = FY - pl.rect.h;
        pl.vx=0; pl.vy=0;
        g.enemies.length = 0;            // isolate the cards from the minions
        window.__flush(i*(1000/60));
        if(bo.state!==prev){ if(bo.state==='throw') throws++; prev=bo.state; }
      }
      return {hits, throws};
    }, [PX, FY]);
    console.log('  '+LBL.padEnd(21)+' x='+String(PX).padStart(3)+' pies='+FY+
      '  golpes='+String(r.hits).padStart(3)+'  lanzamientos='+r.throws);
    await p.close();
  }
  await b.close();
})().catch(e=>{console.error('FALLO: '+e.message);process.exit(9);});
