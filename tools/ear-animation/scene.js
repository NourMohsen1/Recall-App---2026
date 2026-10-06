import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const META = {"nv": 64737, "nf": 129024, "lo": [-0.6729673295271948, -1.0000000000000002, -0.17595693476502294], "hi": [0.6729673295271948, 1.0, 0.17595693476502294], "pad": 0, "canal": [-0.3582, -0.1701, -0.176], "dots": [[-0.4252, 0.589, 0.1568], [-0.3573, 0.6943, 0.1551], [-0.2772, 0.7914, 0.1546], [-0.1927, 0.8673, 0.1609], [-0.0838, 0.9305, 0.1645], [0.025, 0.962, 0.1626], [0.1502, 0.9559, 0.1562], [0.2589, 0.9244, 0.1567], [0.3688, 0.8632, 0.1552], [0.4636, 0.7809, 0.1527], [0.5324, 0.6909, 0.1562], [0.5865, 0.5776, 0.1508], [0.6172, 0.4687, 0.1517], [0.6364, 0.3448, 0.1507], [0.6371, 0.2324, 0.1527], [0.6185, 0.109, 0.1601], [0.5928, 0.0002, 0.1621], [0.5519, -0.1168, 0.1645], [0.4994, -0.2289, 0.1608], [0.4487, -0.3284, 0.1553], [0.3861, -0.4362, 0.1437], [0.3236, -0.5302, 0.136], [0.25, -0.6328, 0.1334], [0.1745, -0.7184, 0.1389], [0.0795, -0.8027, 0.1496], [-0.0246, -0.8762, 0.1707]]};
const LOOP = 12, PH = 4;                       // three phrases per loop, each ends with a save
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const SPEED = reduce ? 0.5 : 1;
const $ = id => document.getElementById(id);
const stage = $('stage'), glc = $('gl'), subEl = $('sub'), titleEl = $('title'), msg = $('msg');
const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const lerp = (a,b,t) => a + (b-a)*t;
const seg = (t,a,b) => clamp((t-a)/(b-a),0,1);
const smooth = t => t*t*(3-2*t);
const easeOut = t => 1 - Math.pow(1-t,3);
const easeInOut = t => t<.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2;
const TAU = Math.PI*2;
const wrap = (x, m) => ((x % m) + m) % m;
let seed = 7; const srand = () => (seed = (seed*16807) % 2147483647) / 2147483647;

const GLSL_COMMON = `
const vec3 CY = vec3(0.44,0.96,0.90); const vec3 MINT = vec3(0.72,1.0,0.90);
vec3 safe(vec3 c){ c = max(c, vec3(0.0)); c = min(c, vec3(24.0)); return (c.r==c.r && c.g==c.g && c.b==c.b) ? c : vec3(0.0); }
vec3 safeN(vec3 n){ float l = length(n); return l > 1e-5 ? n/l : vec3(0.0,0.0,1.0); }`;

/* ---------- voice + typing rhythm (deterministic, loops seamlessly) ---------- */
function gate(t){ const p = wrap(t, PH); return smooth(seg(p, 0.3, 0.5))*(1 - smooth(seg(p, 2.65, 2.95))); }
function voiceAmp(t){
  t = wrap(t, LOOP);
  const syl = Math.pow(Math.abs(Math.sin(Math.PI*4.5*t + 0.7*Math.sin(TAU*t*0.5))), 0.7);
  const word = 0.5 + 0.5*Math.sin(TAU*t*1.25 + 1.3*Math.sin(TAU*t/3));
  const jit = 0.82 + 0.18*Math.sin(TAU*t*17/1.0 + 2.0);
  return clamp(gate(t)*syl*(0.35 + 0.65*word)*jit, 0, 1);
}
// keystrokes: bursts of letters with gaps between words, inside each phrase
const KEYS = [];
for (let k=0; k<LOOP/PH; k++){
  let t = k*PH + 0.4;
  while (t < k*PH + 2.8){
    const n = 3 + Math.floor(srand()*5);
    for (let i=0;i<n && t < k*PH + 2.8;i++){ KEYS.push({t, g: Math.floor(srand()*26), r: srand()}); t += 0.085 + srand()*0.06; }
    t += 0.16 + srand()*0.12;
  }
}
function typeAmp(t){
  let a = 0; t = wrap(t, LOOP);
  for (const k of KEYS){ let d = t - k.t; if (d < 0) d += LOOP; if (d < 0.5) a += Math.exp(-d/0.07); }
  return clamp(a*0.75, 0, 1);
}

/* ---------- renderer ---------- */
THREE.ColorManagement.enabled = false;
let renderer;
try { renderer = new THREE.WebGLRenderer({canvas: glc, antialias: false, powerPreference:'high-performance'}); }
catch(e){ msg.textContent = 'This preview needs WebGL to play.'; throw e; }
renderer.setClearColor(0x021416, 1);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;
glc.addEventListener('webglcontextlost', e => { e.preventDefault(); msg.style.opacity = 1; msg.textContent = 'Reloading the preview…'; setTimeout(() => location.reload(), 600); });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 40);
camera.position.set(0, 0.05, 4.6); camera.lookAt(0, 0, 0);
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(4, 4, {type: THREE.HalfFloatType, samples: 4}));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256,256), 0.65, 0.5, 0.5);
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* ---------- background halo ---------- */
const bgU = { uAmp:{value:0}, uSave:{value:0}, uC:{value:new THREE.Vector2(0.6,0.5)}, uAsp:{value:1} };
const bg = new THREE.Mesh(new THREE.PlaneGeometry(2,2), new THREE.ShaderMaterial({
  depthTest:false, depthWrite:false, uniforms: bgU,
  vertexShader:`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }`,
  fragmentShader: GLSL_COMMON + `uniform float uAmp, uSave, uAsp; uniform vec2 uC; varying vec2 vUv;
    void main(){ vec2 d = (vUv - uC)*vec2(uAsp, 1.0); float r = length(d);
      vec3 col = vec3(0.008,0.078,0.086) + CY*(0.10 + 0.05*uAmp + 0.06*uSave)*exp(-r*r*3.2);
      gl_FragColor = vec4(safe(col), 1.0); }`
}));
bg.renderOrder = -10; bg.frustumCulled = false; scene.add(bg);

/* ---------- the ear ---------- */
const earGroup = new THREE.Group(); earGroup.scale.setScalar(0.82); scene.add(earGroup);
const EU = { uT:{value:0}, uAmp:{value:0}, uSaveR:{value:-1}, uSaveA:{value:0}, uGlow:{value:0} };
const earMat = new THREE.ShaderMaterial({
  uniforms: EU, side: THREE.DoubleSide,
  vertexShader:`attribute float aFold; attribute float aDist;
    varying float vF; varying float vD; varying vec3 vWN; varying vec3 vWP; varying vec3 vObj;
    void main(){ vF = aFold; vD = aDist; vObj = position; vWN = mat3(modelMatrix)*normal; vec4 wp = modelMatrix*vec4(position,1.0); vWP = wp.xyz; gl_Position = projectionMatrix*viewMatrix*wp; }`,
  fragmentShader: GLSL_COMMON + `
    uniform float uT, uAmp, uSaveR, uSaveA, uGlow;
    varying float vF; varying float vD; varying vec3 vWN; varying vec3 vWP; varying vec3 vObj;
    float hash(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x + p.y + p.z)); }
    float vnoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f*f*(3.0 - 2.0*f);
      return mix(mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x), mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
                 mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x), mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z); }
    void main(){
      vec3 N = safeN(vWN); if (!gl_FrontFacing) N = -N;
      // fine skin grain so the surface reads as tissue, not liquid
      vec3 gp = vObj*90.0;
      vec3 grain = vec3(vnoise(gp), vnoise(gp + 17.3), vnoise(gp + 41.7)) - 0.5;
      vec3 gp2 = vObj*28.0;
      grain += 0.3*(vec3(vnoise(gp2 + 5.1), vnoise(gp2 + 23.9), vnoise(gp2 + 61.2)) - 0.5);
      N = safeN(N + grain*0.11);
      vec3 V = normalize(cameraPosition - vWP);
      float f = vF;
      float ao = mix(0.3, 1.0, smoothstep(0.05, 0.8, f));
      vec3 base = mix(vec3(0.014,0.085,0.09), vec3(0.042,0.25,0.25), smoothstep(0.08, 0.9, f));
      vec3 L1 = normalize(vec3(-0.6, 0.9, 0.7)); vec3 L2 = normalize(vec3(0.9, 0.2, -0.5)); vec3 L3 = normalize(vec3(0.5, -0.5, 0.6));
      float w1 = dot(N,L1)*0.5 + 0.5; float d1 = w1*w1;
      float d2 = pow(max(dot(N,L2),0.0), 1.5); float d3 = max(dot(N,L3),0.0);
      vec3 H1 = normalize(L1 + V); float nh = max(dot(N,H1),0.0);
      float spec = pow(nh, 10.0)*0.10 + pow(nh, 48.0)*0.10*smoothstep(0.4, 1.0, f);
      float soft = 0.0;
      float fill = pow(max(dot(N, V), 0.0), 1.5);
      float fr = pow(1.0 - abs(dot(N,V)), 3.0);
      vec3 col = base*(0.24 + 1.3*d1 + 0.35*d3 + 0.55*fill)*ao + base*d2*1.1*ao + spec*vec3(0.6,0.95,0.92)*ao + fr*CY*0.30*ao;
      // definition: a crisp shadow line in each crease and a soft highlight on each fold's edge
      float crease = 1.0 - smoothstep(0.0, fwidth(vF)*1.4 + 0.01, abs(vF - 0.22));
      float crest = smoothstep(0.78, 0.97, f);
      col *= mix(0.62, 1.0, smoothstep(0.0, 0.5, f));
      col += CY*crest*0.05*(0.4 + d1);
      // sound collected by the ear: pulses run along its folds toward the canal
      float line = 1.0 - smoothstep(0.0, fwidth(vF)*1.6 + 0.012, abs(vF - 0.4));
      float ridge = smoothstep(0.6, 0.95, f);
      float band = pow(fract(vD*3.2 + uT*0.85), 9.0) + 0.6*pow(fract(vD*5.1 + uT*1.3 + 0.37), 14.0);
      float flow = band*(line*1.6 + ridge*0.25)*(0.15 + 1.1*uAmp)*smoothstep(1.1, 0.25, vD);
      col += mix(CY, MINT, 0.4)*flow*2.2;
      // canal glow
      col += CY*exp(-vD*vD/0.012)*(0.25 + 1.2*uAmp);
      // "saved" ripple spreading out over the whole ear
      float rp = exp(-pow((vD - uSaveR)/0.045, 2.0))*uSaveA;
      col += MINT*rp*(0.12 + 1.1*line + 0.25*ridge);
      col += CY*uGlow*0.25*ridge;
      gl_FragColor = vec4(safe(col), 1.0);
    }`
});

/* ---------- sound rings (instanced torus tubes along the funnel into the canal) ---------- */
const NR = 12, RING_SEG = 160, RING_SIDES = 6;
const FU = { uC:{value:new THREE.Vector3()}, uD:{value:new THREE.Vector3(-1,0,0)}, uU:{value:new THREE.Vector3()}, uV:{value:new THREE.Vector3()},
             uLen:{value:1.9}, uR0:{value:0.06}, uR1:{value:0.66}, uVis:{value:1}, uT:{value:0} };
function ringGeometry(){
  const pos = [], idx = [];
  for (let i=0;i<=RING_SEG;i++) for (let j=0;j<RING_SIDES;j++) pos.push(i/RING_SEG*TAU, j/RING_SIDES*TAU, 0);
  for (let i=0;i<RING_SEG;i++) for (let j=0;j<RING_SIDES;j++){
    const a = i*RING_SIDES + j, b = i*RING_SIDES + (j+1)%RING_SIDES, c = a + RING_SIDES, d = b + RING_SIDES;
    idx.push(a,c,b, b,c,d);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos,3)); g.setIndex(idx);
  g.setAttribute('iS', new THREE.InstancedBufferAttribute(new Float32Array(NR),1));
  g.setAttribute('iA', new THREE.InstancedBufferAttribute(new Float32Array(NR),1));
  g.setAttribute('iSeed', new THREE.InstancedBufferAttribute(new Float32Array(NR).map(() => srand()*10),1));
  g.instanceCount = NR;
  return g;
}
const rings = new THREE.Mesh(ringGeometry(), new THREE.ShaderMaterial({
  uniforms: FU, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending,
  vertexShader:`attribute float iS; attribute float iA; attribute float iSeed;
    uniform vec3 uC, uD, uU, uV; uniform float uLen, uR0, uR1, uT;
    varying float vA; varying float vS; varying float vSide;
    void main(){
      float th = position.x, ph = position.y, s = iS;
      float R = mix(uR0, uR1, pow(s, 0.85));
      // the ring carries the voice: it ripples with the loudness it was born with
      float wob = 1.0 + iA*0.045*sin(th*6.0 + iSeed*3.0 + uT*2.0) + iA*0.02*sin(th*11.0 - iSeed*5.0);
      float w = mix(0.0025, 0.0085, s)*(0.6 + 0.8*iA);
      vec3 radial = cos(th)*uU + sin(th)*uV;
      vec3 c = uC + uD*uLen*s;
      vec3 p = c + radial*R*wob + (radial*cos(ph) + uD*sin(ph))*w;
      vA = iA; vS = s; vSide = cos(ph);
      gl_Position = projectionMatrix*viewMatrix*vec4(p,1.0);
    }`,
  fragmentShader: GLSL_COMMON + `uniform float uVis; varying float vA; varying float vS; varying float vSide;
    void main(){
      float fade = smoothstep(1.0, 0.82, vS)*smoothstep(0.0, 0.1, vS);
      vec3 col = mix(CY, MINT, 0.35)*(0.25 + 1.3*vA)*fade*(0.75 + 0.25*vSide);
      gl_FragColor = vec4(safe(col*uVis), 1.0);
    }`
}));
rings.frustumCulled = false; rings.renderOrder = 2; scene.add(rings);

/* ---------- waveform bars streaming into the canal ---------- */
const NBAR = 84;
const barGeo = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1,1));
barGeo.setAttribute('iS', new THREE.InstancedBufferAttribute(new Float32Array(NBAR).map((_,i) => 0.035 + i/(NBAR-1)*0.9),1));
barGeo.setAttribute('iH', new THREE.InstancedBufferAttribute(new Float32Array(NBAR),1));
barGeo.instanceCount = NBAR;
const bars = new THREE.Mesh(barGeo, new THREE.ShaderMaterial({
  uniforms: FU, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending,
  vertexShader:`attribute float iS; attribute float iH; uniform vec3 uC, uD; uniform float uLen;
    varying vec2 vUv; varying float vS; varying float vH;
    void main(){
      vUv = uv; vS = iS; vH = iH;
      vec3 c = uC + uD*uLen*iS;
      vec3 up = vec3(0.0,1.0,0.0); vec3 side = normalize(cross(up, normalize(cameraPosition - c)));
      float wdt = mix(0.006, 0.014, iS), h = 0.012 + iH*mix(0.08, 0.34, pow(iS, 0.8));
      vec3 p = c + side*position.x*wdt + up*position.y*h;
      gl_Position = projectionMatrix*viewMatrix*vec4(p,1.0);
    }`,
  fragmentShader: GLSL_COMMON + `uniform float uVis; varying vec2 vUv; varying float vS; varying float vH;
    void main(){
      float y = abs(vUv.y - 0.5)*2.0, x = abs(vUv.x - 0.5)*2.0;
      float core = (1.0 - smoothstep(0.55, 1.0, x))*(1.0 - smoothstep(0.75, 1.0, y));
      float fade = smoothstep(0.96, 0.78, vS)*smoothstep(0.03, 0.12, vS);
      vec3 col = mix(MINT, CY, y)*(0.35 + 0.9*vH)*core*fade;
      gl_FragColor = vec4(safe(col*uVis), 1.0);
    }`
}));
bars.frustumCulled = false; bars.renderOrder = 2; scene.add(bars);

/* ---------- typed letters streaming into the canal ---------- */
function glyphAtlas(){
  const cell = 64, cv = document.createElement('canvas'); cv.width = cv.height = cell*8;
  const c = cv.getContext('2d'); c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = `500 ${cell*0.62}px Inter, system-ui, sans-serif`;
  const L = 'abcdefghijklmnopqrstuvwxyz';
  for (let i=0;i<26;i++){
    const x = (i%8)*cell + cell/2, y = Math.floor(i/8)*cell + cell/2;
    c.shadowColor = 'rgba(111,245,230,0.9)'; c.shadowBlur = 10; c.fillStyle = '#d8fff8'; c.fillText(L[i], x, y + 2);
    c.shadowBlur = 0; c.fillText(L[i], x, y + 2);
  }
  const t = new THREE.CanvasTexture(cv); t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; return t;
}
const NG = 48;
const glyphGeo = new THREE.BufferGeometry();
glyphGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(NG*3),3));
glyphGeo.setAttribute('aG', new THREE.Float32BufferAttribute(new Float32Array(NG),1));
glyphGeo.setAttribute('aA', new THREE.Float32BufferAttribute(new Float32Array(NG),1));
glyphGeo.setAttribute('aSz', new THREE.Float32BufferAttribute(new Float32Array(NG),1));
const glyphU = { uMap:{value:null}, uScale:{value:300}, uVis:{value:0} };
const glyphs = new THREE.Points(glyphGeo, new THREE.ShaderMaterial({
  uniforms: glyphU, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending,
  vertexShader:`attribute float aG; attribute float aA; attribute float aSz; uniform float uScale; varying float vG; varying float vA;
    void main(){ vG = aG; vA = aA; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = aSz*uScale/max(-mv.z, 0.1); gl_Position = projectionMatrix*mv; }`,
  fragmentShader: GLSL_COMMON + `uniform sampler2D uMap; uniform float uVis; varying float vG; varying float vA;
    void main(){ vec2 cell = vec2(mod(vG, 8.0), floor(vG/8.0));
      vec2 uv = (cell + vec2(gl_PointCoord.x, gl_PointCoord.y))/8.0; uv.y = 1.0 - uv.y;
      vec4 g = texture2D(uMap, uv);
      gl_FragColor = vec4(safe(g.rgb*g.a*vA*uVis*1.4), 1.0); }`
}));
glyphs.frustumCulled = false; glyphs.renderOrder = 3; scene.add(glyphs);

/* ---------- sprites: rim meter dots, the saved bead, dust ---------- */
const spriteVS = `attribute float aSize; attribute vec3 aCol; attribute float aAlpha;
  uniform float uScale; uniform float uMax; varying vec3 vCol; varying float vA;
  void main(){ vCol = aCol; vA = aAlpha; vec4 mv = modelViewMatrix*vec4(position,1.0);
    gl_PointSize = min(aSize*uScale/max(-mv.z, 0.1), uMax); gl_Position = projectionMatrix*mv; }`;
const spriteFS = GLSL_COMMON + `uniform float uVis; varying vec3 vCol; varying float vA;
  void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c);
    float core = smoothstep(0.17, 0.0, d); float halo = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(safe(vCol*(core*1.4 + halo*halo*0.6)*vA*uVis), 1.0); }`;
const sprites = [];
function points(n, order){
  const m = new THREE.ShaderMaterial({ uniforms:{uScale:{value:300}, uMax:{value:60}, uVis:{value:1}}, vertexShader:spriteVS, fragmentShader:spriteFS,
    transparent:true, depthWrite:false, blending:THREE.AdditiveBlending });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n*3),3));
  g.setAttribute('aSize', new THREE.Float32BufferAttribute(new Float32Array(n),1));
  g.setAttribute('aCol', new THREE.Float32BufferAttribute(new Float32Array(n*3).fill(1),3));
  g.setAttribute('aAlpha', new THREE.Float32BufferAttribute(new Float32Array(n),1));
  const p = new THREE.Points(g, m); p.renderOrder = order; p.frustumCulled = false; sprites.push(p); return p;
}
const NDOT = META.dots.length;
const dots = points(NDOT, 3); earGroup.add(dots);
META.dots.forEach((d,i) => dots.geometry.attributes.position.setXYZ(i, d[0], d[1], d[2]));
const bead = points(3, 4); scene.add(bead);                    // halo, core, flash
const NDUST = 140, dust = points(NDUST, 1); scene.add(dust);
const dustSeed = Array.from({length:NDUST}, () => ({s: srand(), a: srand()*TAU, r: 0.75 + srand()*1.4, sp: 0.05 + srand()*0.08, sz: 1.5 + srand()*2.5}));

/* ---------- decode the ear ---------- */
async function gunzipB64(b64){
  const s = atob(b64); const u = new Uint8Array(s.length);
  for (let i=0;i<s.length;i++) u[i] = s.charCodeAt(i);
  return new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
async function loadEar(){
  const buf = await gunzipB64($('meshdata').textContent.trim());
  const {nv, nf, lo, hi, pad} = META;
  const q = new Uint16Array(buf, 0, nv*3);
  const fold = new Uint8Array(buf, nv*6, nv), dist = new Uint8Array(buf, nv*7, nv);
  const idx = new Uint32Array(buf, nv*8 + pad, nf*3);
  const pos = new Float32Array(nv*3);
  for (let i=0;i<nv*3;i++) pos[i] = lo[i%3] + q[i]/65535*(hi[i%3]-lo[i%3]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos,3));
  g.setAttribute('aFold', new THREE.BufferAttribute(fold,1,true));
  g.setAttribute('aDist', new THREE.BufferAttribute(dist,1,true));
  g.setIndex(new THREE.BufferAttribute(idx,1));
  g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}

/* ---------- layout ---------- */
let W, H, DPR, qDPR = Math.min(window.devicePixelRatio || 1, 1.75), drops = 0, portrait = false;
const EAR_BASE = new THREE.Vector3(0.62, 0.02, 0), FUN_DIR = new THREE.Vector3(-1, 0.06, 0.62).normalize();
function applySize(){
  DPR = qDPR;
  renderer.setPixelRatio(DPR); renderer.setSize(W, H, false); composer.setPixelRatio(DPR); composer.setSize(W, H);
  glc.style.width = W+'px'; glc.style.height = H+'px';
  const scale = H*DPR*0.5/Math.tan(THREE.MathUtils.degToRad(34/2));
  sprites.forEach(p => { p.material.uniforms.uScale.value = scale*0.0021; p.material.uniforms.uMax.value = 60*DPR; });
  bead.material.uniforms.uMax.value = 160*DPR;
  glyphU.uScale.value = scale*0.0021;
}
function layout(){
  const r = stage.getBoundingClientRect(); W = Math.max(1, r.width); H = Math.max(1, r.height);
  camera.aspect = W/H; portrait = W/H < 0.9;
  camera.setViewOffset(W, H, 0, H*0.07, W, H);
  camera.position.z = portrait ? 4.6/Math.max(W/H, 0.5)*0.62 : 4.6;
  camera.updateProjectionMatrix();
  earGroup.position.copy(EAR_BASE); earGroup.scale.setScalar(portrait ? 0.62 : 0.82); if (portrait) earGroup.position.set(0.3, 0.3, 0);
  bgU.uAsp.value = W/H;
  applySize();
}

/* ---------- mode ---------- */
let mode = 'voice', mix = 0;   // 0 voice, 1 typing
function setMode(m){ mode = m; $('bVoice').setAttribute('aria-pressed', m === 'voice'); $('bType').setAttribute('aria-pressed', m === 'type'); curSub = ''; }
$('bVoice').onclick = () => setMode('voice'); $('bType').onclick = () => setMode('type');
let paused = false;
$('pp').onclick = () => { paused = !paused; $('pp').textContent = paused ? 'Play' : 'Pause'; $('pp').setAttribute('aria-label', paused ? 'Play animation' : 'Pause animation'); };
let curSub = '';
function setSub(text, saved){
  if (curSub === text) return; curSub = text;
  subEl.classList.add('out');
  setTimeout(() => { subEl.textContent = text; subEl.classList.toggle('saved', !!saved); subEl.classList.remove('out'); }, 250);
}

/* ---------- loop ---------- */
let time = 0, last = 0, lastMs = 0, ema = 16, ampS = 0;
const hm = location.hash.match(/t=([\d.]+)/); let freezeAt = null;
if (hm){ freezeAt = parseFloat(hm[1]); time = Math.max(0, freezeAt - 0.1); }
if (location.hash.includes('type')){ setMode('type'); mix = 1; }
const C = new THREE.Vector3(), U = new THREE.Vector3(), Vv = new THREE.Vector3(), tmp = new THREE.Vector3(), canalLocal = new THREE.Vector3(...META.canal);
const TRAVEL = 1.7, RSTEP = 0.18;          // rings: born every 0.18 s, 1.7 s to reach the canal (LOOP/RSTEP is whole)

function frame(ms){
  requestAnimationFrame(frame);
  const real = ms - lastMs; lastMs = ms;
  let dt = Math.min(.05, (ms - last)/1000)*SPEED; last = ms;
  if (freezeAt !== null) dt = Math.min(1/60, Math.max(0, freezeAt - time));
  if (paused) dt = 0;
  time += dt;
  const t = time, lt = wrap(time, LOOP), pl = wrap(time, PH);
  mix = lerp(mix, mode === 'type' ? 1 : 0, 1 - Math.exp(-dt*4));
  if (freezeAt === null && !paused){ ema = ema*0.95 + real*0.05;
    if (ema > 26 && pl > 3.2 && drops < 2 && qDPR > 1){ qDPR = Math.max(1, qDPR - 0.375); drops++; applySize(); ema = 16; } }

  // loudness of what's arriving right now at the canal (sound takes TRAVEL seconds to get there)
  const ampNow = lerp(voiceAmp(t - TRAVEL), typeAmp(t - TRAVEL*0.9), mix);
  ampS = lerp(ampS, ampNow, 1 - Math.exp(-dt*14));

  // save beat at the end of each phrase
  const beadForm = smooth(seg(pl, 2.75, 3.15)), beadIn = easeInOut(seg(pl, 3.15, 3.55));
  const beadOn = beadForm*(1 - smooth(seg(pl, 3.45, 3.6)));
  const saveR = lerp(-0.05, 1.25, easeOut(seg(pl, 3.45, 4.0 + 0.6))), saveA = pl > 3.45 ? Math.pow(1 - seg(pl, 3.45, 4.0 + 0.6), 1.3) : 0;
  const flash = Math.exp(-Math.pow((pl - 3.52)/0.12, 2));

  // ear: a slow, breathing float
  earGroup.rotation.set(0.05 + Math.sin(t*0.4)*0.03, -0.38 + Math.sin(t*0.27)*0.06, Math.sin(t*0.33)*0.02);
  earGroup.position.y = (portrait ? 0.3 : 0.02) + Math.sin(t*0.8)*0.025;
  earGroup.updateMatrixWorld();
  C.copy(canalLocal); earGroup.localToWorld(C);
  EU.uT.value = t; EU.uAmp.value = ampS; EU.uSaveR.value = saveR; EU.uSaveA.value = saveA; EU.uGlow.value = flash*0.8;

  // funnel frame
  const D = FUN_DIR; U.set(0,1,0).sub(tmp.copy(D).multiplyScalar(D.y)).normalize(); Vv.crossVectors(D, U).normalize();
  FU.uC.value.copy(C); FU.uD.value.copy(D); FU.uU.value.copy(U); FU.uV.value.copy(Vv); FU.uT.value = t;
  FU.uLen.value = portrait ? 1.35 : 1.95;

  // rings: each carries the loudness it was born with
  const ra = rings.geometry.attributes, base = Math.floor(lt/RSTEP);
  for (let k=0;k<NR;k++){
    const j = base - k, born = j*RSTEP, age = lt - born, s = 1 - age/TRAVEL;
    const a = lerp(voiceAmp(born), typeAmp(born)*0.6, mix);
    ra.iS.setX(k, s >= 0 ? s : -1); ra.iA.setX(k, s >= 0 ? Math.max(a, 0.05) : 0);
  }
  ra.iS.needsUpdate = ra.iA.needsUpdate = true;
  rings.material.uniforms.uVis.value = lerp(1, 0.55, mix);

  // waveform bars: the voice in flight toward the canal
  const bh = bars.geometry.attributes.iH, bs = bars.geometry.attributes.iS;
  for (let i=0;i<NBAR;i++){ const s = bs.getX(i); bh.setX(i, voiceAmp(t - (1 - s)*TRAVEL)*(0.75 + 0.25*Math.sin(i*2.3 + t*9))); }
  bh.needsUpdate = true;
  bars.visible = mix < 0.99;

  // typed letters spiralling in
  const ga = glyphGeo.attributes; let n = 0;
  if (mix > 0.01){
    for (const k of KEYS){
      let age = lt - k.t; if (age < 0) age += LOOP;
      const T = 1.45; if (age > T || n >= NG) continue;
      const s = 1 - easeInOut(age/T)*0.97, R = lerp(0.05, 0.42, s)*(0.4 + 0.6*k.r);
      const th = k.r*TAU + (1 - s)*3.2;
      tmp.copy(C).addScaledVector(D, FU.uLen.value*s*0.92).addScaledVector(U, Math.cos(th)*R).addScaledVector(Vv, Math.sin(th)*R);
      ga.position.setXYZ(n, tmp.x, tmp.y, tmp.z); ga.aG.setX(n, k.g);
      ga.aA.setX(n, smooth(seg(age, 0, 0.15))*smooth(seg(s, 0.03, 0.2)));
      ga.aSz.setX(n, lerp(26, 110, Math.pow(s, 0.9))); n++;
    }
  }
  for (let i=n;i<NG;i++) ga.aA.setX(i, 0);
  ga.position.needsUpdate = ga.aG.needsUpdate = ga.aA.needsUpdate = ga.aSz.needsUpdate = true;
  glyphU.uVis.value = mix;
  glyphs.visible = mix > 0.01;

  // rim dots: a level meter from the lobe up, then a full sweep when saved
  const da = dots.geometry.attributes, lvl = ampS*NDOT*1.15, sweep = seg(pl, 3.45, 4.15)*(NDOT + 6);
  for (let i=0;i<NDOT;i++){
    const fromLobe = NDOT - 1 - i;
    let a = 0.3 + 0.12*Math.sin(t*2 + i*0.7);
    a += clamp(lvl - fromLobe, 0, 1)*0.85;
    const sw = pl > 3.45 ? Math.exp(-Math.pow((fromLobe - sweep + 3)/2.2, 2)) : 0;
    a = clamp(a + sw, 0, 1.4);
    da.aAlpha.setX(i, a); da.aSize.setX(i, 8 + 7*clamp(lvl - fromLobe, 0, 1) + 8*sw);
    da.aCol.setXYZ(i, lerp(0.44, 0.85, sw), lerp(0.96, 1.0, sw), lerp(0.90, 0.97, sw));
  }
  da.aAlpha.needsUpdate = da.aSize.needsUpdate = da.aCol.needsUpdate = true;

  // the bead: the phrase condensed, then slipped into the canal
  const pa = bead.geometry.attributes;
  tmp.copy(C).addScaledVector(D, lerp(0.16, -0.06, beadIn));
  for (let i=0;i<3;i++) pa.position.setXYZ(i, tmp.x, tmp.y, tmp.z);
  const bsz = beadForm*(1 - 0.55*beadIn);
  pa.aSize.setX(0, 70*bsz); pa.aAlpha.setX(0, 0.5*beadOn); pa.aCol.setXYZ(0, 0.5, 1.0, 0.92);
  pa.aSize.setX(1, 24*bsz); pa.aAlpha.setX(1, beadOn); pa.aCol.setXYZ(1, 0.9, 1.0, 0.97);
  pa.aSize.setX(2, 150*flash); pa.aAlpha.setX(2, 0.35*flash); pa.aCol.setXYZ(2, 0.5, 1.0, 0.92);
  pa.position.needsUpdate = pa.aSize.needsUpdate = pa.aAlpha.needsUpdate = pa.aCol.needsUpdate = true;

  // dust drifting in toward the ear
  const dda = dust.geometry.attributes;
  for (let i=0;i<NDUST;i++){
    const d = dustSeed[i], s = wrap(d.s - t*d.sp, 1);
    const R = d.r*(0.25 + 0.75*s);
    tmp.copy(C).addScaledVector(D, 2.4*s).addScaledVector(U, Math.cos(d.a + s*2)*R).addScaledVector(Vv, Math.sin(d.a + s*2)*R);
    dda.position.setXYZ(i, tmp.x, tmp.y, tmp.z); dda.aSize.setX(i, d.sz); dda.aCol.setXYZ(i, 0.44, 0.96, 0.9);
    dda.aAlpha.setX(i, 0.35*smooth(seg(s, 0.02, 0.2))*smooth(seg(1 - s, 0.0, 0.3)));
  }
  dda.position.needsUpdate = dda.aAlpha.needsUpdate = true;

  tmp.copy(C).project(camera); bgU.uC.value.set(tmp.x*0.5 + 0.5 - 0.05, tmp.y*0.5 + 0.5);
  bgU.uAmp.value = ampS; bgU.uSave.value = saveA;
  bloom.strength = 0.65 + 0.1*ampS + 0.25*flash;

  composer.render();

  // caption
  const saving = pl > 3.3 || pl < 0.25;
  if (saving) setSub('Saved to your memories', true);
  else setSub(mode === 'type' ? 'Taking in what you type' : 'Capturing your voice');
}

/* ---------- start ---------- */
(async () => {
  try {
    if (document.fonts && document.fonts.ready) { try { await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))]); } catch(e){} }
    glyphU.uMap.value = glyphAtlas();
    const g = await loadEar();
    earGroup.add(new THREE.Mesh(g, earMat));
    layout();
    scene.traverse(o => { o.visible = true; });
    try { await renderer.compileAsync(scene, camera); } catch(e){ renderer.compile(scene, camera); }
    composer.render();
    glc.classList.add('on');
    msg.style.opacity = 0; setTimeout(() => msg.remove(), 700);
    requestAnimationFrame(ms => { last = lastMs = ms; frame(ms); });
  } catch(e){ msg.textContent = 'Couldn’t load the ear model.'; console.error(e); }
})();
let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(layout, 80); });
