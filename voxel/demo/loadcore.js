// Loads the shared modules as ONE ordinary function scope and returns their
// exports. Timing in a vm context is misleading: global lookups there go through
// a proxy and run 10-20x slower than in a browser or worker, which made a healthy
// generator look broken. Use this for anything that measures speed.
const fs = require('fs'), path = require('path');
module.exports = function (names, expose) {
  const root = path.join(__dirname, '..', 'src');
  const src = names.map(n => fs.readFileSync(path.join(root, n + '.js'), 'utf8')).join('\n;\n');
  const fn = new Function('performance', src + '\n;return {' + expose + '};');
  return fn(performance);
};
