// Dumps every rollout candidate at each grounded frame inside an x window, so
// the controller's actual reasoning can be read instead of inferred.
const { execSync } = require('child_process'); const fs=require('fs'); const path=require('path');
const { chromium } = require(path.join(execSync('npm root -g').toString().trim(),'playwright'));
const LV=+process.argv[2], X0=+process.argv[3], X1=+process.argv[4], SECS=+(process.argv[5]||30);
(async()=>{
  const src = fs.readFileSync(path.join(__dirname,'aprollout.js'),'utf8')+'\n;\n'+
              fs.readFileSync(path.join(__dirname,'autopilot.js'),'utf8');
  const b=await chromium.launch(); const pg=await b.newPage({viewport:{width:900,height:600}});
  await pg.addInitScript(()=>{window.__capture=true;window.__q=[];
    window.requestAnimationFrame=c=>{window.__q.push(c);return 1;};
    window.cancelAnimationFrame=()=>{};
    window.__flush=ts=>{const q=window.__q;window.__q=[];for(const c of q){try{c(ts)}catch(e){}}};});
  await pg.goto('file://'+path.join(__dirname,'game.html'),{waitUntil:'load'});
  await pg.waitForFunction(()=>!!window.__game,null,{timeout:20000});
  await pg.evaluate(a=>{ (0,eval)(a[0]); const g=window.__game; g.draw=()=>{};
    g.startRun(); g.lvIdx=a[1]; g.loadLevel(a[1]); g.state='play'; window.__pj=false;
    window.__go=(n,fps,x0,x1)=>{ const log=[];
      for(let i=0;i<n;i++){ const gg=window.__game, p=gg.player; let act={L:0,R:0,run:0,jump:0};
        try{act=AUTOPILOT(gg,i)||act}catch(e){}
        if(p&&p.onGround&&p.rect.x>=x0&&p.rect.x<=x1&&log.length<40){
          const foes=RO_foes(gg,p); const cands=[];
          for(const h of RO_HOLDS) for(const d of RO_DIRS) for(const r of [0,1]){
            if(d===0&&r) continue;
            const o=RO_sim(gg,gg.world,p,h,r===1,80,foes,d);
            cands.push({h:h,d:d,r:r,sc:Math.round(RO_score(gg,gg.world,p,o,h,r===1)-(d!==1?55:0)),
                        x:Math.round(o.x),dead:o.dead,hit:o.hits,st:o.stomps});
          }
          cands.sort((a,b)=>b.sc-a.sc);
          log.push({f:i,x:Math.round(p.rect.x),top:cands.slice(0,4)});
        }
        IN.L=!!act.L;IN.R=!!act.R;IN.run=!!act.run;
        if(act.jump&&!window.__pj){IN.jumpBuf=BUFFER;IN.anyPress=true;}
        IN.jumpHeld=!!act.jump;window.__pj=!!act.jump;
        window.__flush(i*(1000/fps));
      } return log; };
  },[src,LV]);
  const log=await pg.evaluate(a=>window.__go(a[0],60,a[1],a[2]),[Math.round(SECS*60),X0,X1]);
  for(const e of log) console.log('f'+e.f+' x='+e.x+'  '+e.top.map(c=>
    'h'+c.h+(c.d===1?'R':'0')+(c.r?'+run':'')+'='+c.sc+(c.dead?'DEAD':'')+(c.hit?'H'+c.hit:'')+(c.st?'S'+c.st:'')).join('  '));
  await b.close();
})().catch(e=>{console.error('FAIL '+e.message);process.exit(9)});
