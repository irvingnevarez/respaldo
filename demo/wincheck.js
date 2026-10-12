// Does the victory screen actually draw? In the recorder the Joker's finale froze on
// "NIVEL COMPLETADO" while the state log said 'win'. The recorder swallows draw
// errors, so test with the game's own loop and a normal page-error listener.
const { execSync } = require('child_process'); const path=require('path');
const { chromium } = require(path.join(execSync('npm root -g').toString().trim(),'playwright'));
(async()=>{
  const b=await chromium.launch(); const p=await b.newPage({viewport:{width:1100,height:700}});
  const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{ if(m.type()==='error') errs.push('console: '+m.text()); });
  await p.goto('file://'+path.join(__dirname,'..','game.html'),{waitUntil:'load'});
  await p.waitForFunction(()=>!!window.__game,null,{timeout:25000});
  await p.evaluate(()=>{ const g=window.__game; g.startRun(); g.lvIdx=7; g.loadLevel(7); g.lvIdx=LEVELS.length; g.state='win'; g.stateT=0; g.score=10500; });
  await p.waitForTimeout(1500);
  const st = await p.evaluate(()=>({state:window.__game.state, t:+window.__game.stateT.toFixed(2)}));
  await p.locator('#stage').screenshot({path:'/tmp/claude-0/-home-user-respaldo/d891eaa2-65c0-5bb2-a2e1-04d8609258d5/scratchpad/win-real.png'});
  console.log('estado='+st.state+'  stateT='+st.t+'  (si stateT no avanza, el bucle murió)');
  console.log(errs.length ? 'ERRORES:\n  '+[...new Set(errs)].slice(0,5).join('\n  ') : 'sin errores');
  await b.close();
})().catch(e=>{console.error('FALLO: '+e.message);process.exit(9);});
