// Loudness of a WAV, second by second, as a bar chart in the terminal.
//   node voxel/demo/trailer/wavstat.js <file.wav> [step=1]
const fs = require('fs');
const b = fs.readFileSync(process.argv[2]), step = +(process.argv[3] || 1);
const sr = b.readUInt32LE(24), ch = b.readUInt16LE(22);
let off = 12; while (b.toString('ascii', off, off + 4) !== 'data') off += 8 + b.readUInt32LE(off + 4);
const n = b.readUInt32LE(off + 4) / (2 * ch), d = off + 8;
const per = Math.round(sr * step);
for (let s = 0; s * per < n; s++) {
  let sum = 0, pk = 0, m = 0;
  for (let i = s * per; i < Math.min(n, (s + 1) * per); i++) {
    for (let c = 0; c < ch; c++) { const v = b.readInt16LE(d + (i * ch + c) * 2) / 32768; sum += v * v; pk = Math.max(pk, Math.abs(v)); m++; }
  }
  const rms = Math.sqrt(sum / m), db = 20 * Math.log10(rms + 1e-9);
  console.log(String((s * step).toFixed(1)).padStart(5) + 's ' + (db.toFixed(1) + ' dB').padStart(9) + ' pico ' + pk.toFixed(2) + ' ' + '#'.repeat(Math.max(0, Math.round((db + 50) / 1.2))));
}
