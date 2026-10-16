// ═══════════════════════════════════════════════════════════════════════
//  GL — small helpers over WebGL2: compile, link, framebuffers.
// ═══════════════════════════════════════════════════════════════════════

function GL_compile(gl, type, src, label) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error('shader ' + label + ': ' + log);
  }
  return s;
}

// A linked program with a memoised uniform lookup: prog.u('name') -> location.
function GL_prog(gl, vs, fs, label) {
  const p = gl.createProgram();
  gl.attachShader(p, GL_compile(gl, gl.VERTEX_SHADER, vs, label + '.vs'));
  gl.attachShader(p, GL_compile(gl, gl.FRAGMENT_SHADER, fs, label + '.fs'));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link ' + label + ': ' + gl.getProgramInfoLog(p));
  const cache = {};
  return {
    id: p,
    u: function (n) { let l = cache[n]; if (l === undefined) { l = gl.getUniformLocation(p, n); cache[n] = l; } return l; },
  };
}

// A texture usable as a render target. `fmt` is 'f16' (HDR) or 'u8'.
function GL_tex(gl, w, h, fmt, linear) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  if (fmt === 'f16') gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const f = linear === false ? gl.NEAREST : gl.LINEAR;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

// A framebuffer with a colour texture and, optionally, a depth renderbuffer.
function GL_fbo(gl, w, h, fmt, depth) {
  const tex = GL_tex(gl, w, h, fmt);
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  let rb = null;
  if (depth) {
    rb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
  }
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fb: fb, tex: tex, rb: rb, w: w, h: h, ok: ok, fmt: fmt };
}

function GL_freeFbo(gl, f) {
  if (!f) return;
  gl.deleteFramebuffer(f.fb); gl.deleteTexture(f.tex); if (f.rb) gl.deleteRenderbuffer(f.rb);
}
