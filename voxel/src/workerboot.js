// Worker entry point. Appended ONLY to the worker's source, never to the main
// script, so the main thread does not install a message handler of its own.
self.onmessage = function (e) {
  const m = e.data;
  if (m.t === 'bake') {
    const t0 = Date.now();
    const r = JB_bakeNow(m.cx, m.cz);
    r.id = m.id; r.ms = Date.now() - t0;
    self.postMessage(r, JB_transfers(r));
  }
};
self.postMessage({ t: 'ready' });
