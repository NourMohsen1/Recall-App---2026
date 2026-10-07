
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const META = {"nv": 141939, "nf": 283852, "lo": [-0.704784, -1.006727, -0.889506], "hi": [0.705529, 0.626291, 0.88923], "pad": 3, "vox": {"shape": [48, 40, 61], "origin": [-0.69, -0.54, -0.9], "pitch": 0.03, "b64": "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"}};
const LOOP = 15, LOCK = 8.1;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const SPEED = reduce ? 0.5 : 1;
const $ = id => document.getElementById(id);
const stage = $('stage'), glc = $('gl'), hud = $('hud'), hctx = hud.getContext('2d'), subEl = $('sub'), phaseEl = $('phase'), msg = $('msg');

const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
const lerp = (a,b,t) => a + (b-a)*t;
const rand = (a,b) => a + Math.random()*(b-a);
const seg = (t,a,b) => clamp((t-a)/(b-a),0,1);
const smooth = t => t*t*(3-2*t);
const easeInOut = t => t<.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2;
const easeOut = t => 1 - Math.pow(1-t,3);
const easeIn = t => t*t*t;
const easeSine = t => 0.5 - 0.5*Math.cos(Math.PI*t);
const easeOutBack = t => { const c1=1.6, c3=c1+1; return 1 + c3*Math.pow(t-1,3) + c1*Math.pow(t-1,2); };
let seed = 11; const srand = () => (seed = (seed*16807) % 2147483647) / 2147483647;
const sr = (a,b) => a + srand()*(b-a);

const GLSL_NOISE = `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy; i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx; vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_); vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw); vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3))); p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;
// shared colours + a guard so no shader can ever emit NaN/Inf (those turn into black blocks under bloom)
const GLSL_COMMON = `
const vec3 CY = vec3(0.44,0.96,0.90); const vec3 MINT = vec3(0.70,1.0,0.88);
const vec3 GOLD = vec3(1.0,0.66,0.28); const vec3 GOLDW = vec3(1.0,0.84,0.58);
vec3 safe(vec3 c){ c = max(c, vec3(0.0)); c = min(c, vec3(24.0)); return (c.r==c.r && c.g==c.g && c.b==c.b) ? c : vec3(0.0); }
vec3 safeN(vec3 n){ float l = length(n); return l > 1e-5 ? n/l : vec3(0.0,1.0,0.0); }`;

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
const camera = new THREE.PerspectiveCamera(36, 1, 0.01, 40);
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(4, 4, {type: THREE.HalfFloatType, samples: 4}));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256,256), 0.6, 0.5, 0.55);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const CYA = [0.44,0.96,0.90], GOLDA = [1.0,0.66,0.28];

/* ---------- decode packed data ---------- */
async function gunzipB64(b64){
  const s = atob(b64); const u = new Uint8Array(s.length);
  for (let i=0;i<s.length;i++) u[i] = s.charCodeAt(i);
  const ds = new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(ds).arrayBuffer();
}
async function loadBrain(){
  const buf = await gunzipB64($('meshdata').textContent.trim());
  const {nv, nf, lo, hi, pad} = META;
  let o = 0;
  const q = new Uint16Array(buf, 0, nv*3); o += nv*6;
  const fold = new Uint8Array(buf, o, nv); o += nv;
  const an = new Uint8Array(buf, o, nv); o += nv;
  const part = new Uint8Array(buf, o, nv); o += nv;
  const dis = new Uint8Array(buf, o, nv); o += nv;
  const rnd = new Uint8Array(buf, o, nv); o += nv + pad;
  const idx = new Uint32Array(buf, o, nf*3);
  const pos = new Float32Array(nv*3);
  for (let i=0;i<nv;i++) for (let k=0;k<3;k++) pos[i*3+k] = lo[k] + q[i*3+k]/65535*(hi[k]-lo[k]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos,3));
  g.setAttribute('aFold', new THREE.BufferAttribute(fold,1,true));
  g.setAttribute('aN', new THREE.BufferAttribute(an,1,true));
  g.setAttribute('aPart', new THREE.BufferAttribute(part,1,false));
  g.setAttribute('aDis', new THREE.BufferAttribute(dis,1,true));
  g.setAttribute('aRnd', new THREE.BufferAttribute(rnd,1,true));
  g.setIndex(new THREE.BufferAttribute(idx,1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
let VOX = null;
async function loadVox(){
  const v = META.vox; VOX = {bits: new Uint8Array(await gunzipB64(v.b64)), sh: v.shape, o: v.origin, p: v.pitch};
}
function inside(p){
  const {bits, sh, o, p: pt} = VOX;
  const i = Math.round((p.x - o[0])/pt), j = Math.round((p.y - o[1])/pt), k = Math.round((p.z - o[2])/pt);
  if (i<0||j<0||k<0||i>=sh[0]||j>=sh[1]||k>=sh[2]) return false;
  const n = (i*sh[1] + j)*sh[2] + k;
  return (bits[n>>3] >> (7 - (n&7))) & 1;
}

/* ---------- brain materials ---------- */
const U = {
  uTime:{value:0}, uTN:{value:0}, uDis:{value:0}, uHolo:{value:0}, uAct:{value:1},
  uGold:{value:0}, uGoldZ:{value:2}, uGlow:{value:0}
};
const BRAIN_VS = `
  attribute float aFold; attribute float aN; attribute float aPart; attribute float aDis; attribute float aRnd;
  varying float vFold; varying float vN; varying float vPart; varying float vDis; varying float vRnd;
  varying vec3 vObj; varying vec3 vWN; varying vec3 vWP;
  void main(){
    vFold = aFold; vN = aN; vPart = aPart; vDis = aDis; vRnd = aRnd; vObj = position;
    vWN = mat3(modelMatrix) * normal;
    vec4 wp = modelMatrix * vec4(position,1.0); vWP = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const BRAIN_FS_HEAD = GLSL_NOISE + GLSL_COMMON + `
  uniform float uTime, uTN, uDis, uHolo, uAct, uGold, uGoldZ, uGlow;
  varying float vFold; varying float vN; varying float vPart; varying float vDis; varying float vRnd;
  varying vec3 vObj; varying vec3 vWN; varying vec3 vWP;
  // glowing neural threads running along the grooves, flickering region by region
  vec3 activity(out float thread){
    float aw = fwidth(vN)*1.9 + 0.011;
    thread = 1.0 - smoothstep(0.0, aw, vN);
    float cereb = 1.0 - step(0.5, vPart); float stem = step(1.5, vPart);
    float region = smoothstep(-0.05, 0.5, snoise(vObj*1.5 + vec3(0.0, uTN*0.30, uTN*0.19)));
    float flick = 0.55 + 0.45*sin(uTN*5.0 + vRnd*12.0);
    float streak = pow(fract(vRnd*2.0 + vObj.y*1.2 + vObj.z*0.6 - uTN*0.5), 10.0);
    float a = thread*(region*flick + streak*0.85)*uAct*(0.45 + 0.55*cereb)*(1.0 - stem);
    vec3 c = mix(CY, vec3(0.82,1.0,0.96), 0.35 + 0.35*sin(vObj.y*9.0 + uTN));
    // golden "memory retrieved" sweep while pulling back out
    float g = exp(-pow((vObj.z - uGoldZ)/0.24, 2.0))*uGold;
    return c*a*3.4 + GOLD*thread*g*(2.2 + 1.0*flick) + GOLD*g*0.06;
  }`;

const solidMat = new THREE.ShaderMaterial({
  uniforms: U, side: THREE.DoubleSide,
  vertexShader: BRAIN_VS,
  fragmentShader: BRAIN_FS_HEAD + `
  void main(){
    float th = uDis*1.12 - 0.06;
    if (vDis < th) discard;
    float ew = fwidth(vDis)*2.2 + 0.004;
    float edge = (1.0 - smoothstep(0.0, ew, vDis - th)) * step(0.0005, uDis) * step(uDis, 0.9995);
    vec3 N = safeN(vWN); if (!gl_FrontFacing) N = -N;
    vec3 V = normalize(cameraPosition - vWP);
    float f = vFold;
    float ao = mix(0.12, 1.0, smoothstep(0.08, 0.75, vPart > 0.5 && vPart < 1.5 ? 0.35 + 0.65*f : f));
    float fc = vPart > 0.5 && vPart < 1.5 ? 0.35 + 0.65*f : f;
    vec3 base = mix(vec3(0.003,0.024,0.028), vec3(0.025,0.165,0.168), smoothstep(0.12, 0.9, fc));
    vec3 L1 = normalize(vec3(-0.5, 1.0, -0.75)); vec3 L2 = normalize(vec3(0.85, 0.3, 0.6)); vec3 L3 = normalize(vec3(0.7, -0.35, -0.6));
    float w1 = dot(N,L1)*0.5 + 0.5; float d1 = w1*w1;
    float d2 = pow(max(dot(N,L2),0.0), 1.5);
    float d3 = max(dot(N,L3),0.0);
    vec3 H1 = normalize(L1 + V); float nh = max(dot(N,H1),0.0);
    float spec = pow(nh, 28.0)*0.24 + pow(nh, 140.0)*0.42*smoothstep(0.35, 1.0, f);
    float soft = smoothstep(0.62, 1.0, dot(reflect(-V,N), L1))*0.10;
    float fr = pow(1.0 - abs(dot(N,V)), 3.0);
    vec3 col = base*(0.16 + 1.35*d1 + 0.22*d3)*ao + base*d2*0.9 + (spec + soft)*vec3(0.6,0.95,0.92)*ao + fr*CY*0.26*ao;
    float thread; vec3 actC = activity(thread); col += actC;
    col += CY*uGlow*0.3*smoothstep(0.4, 1.0, f);
    // the glowing edge where the brain dissolves open
    col += CY*edge*0.85 + MINT*pow(edge, 4.0)*0.45;
    gl_FragColor = vec4(safe(col), 1.0);
  }`
});
const holoMat = new THREE.ShaderMaterial({
  uniforms: U, side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
  vertexShader: BRAIN_VS,
  fragmentShader: BRAIN_FS_HEAD + `
  void main(){
    vec3 N = safeN(vWN); if (!gl_FrontFacing) N = -N;
    vec3 V = normalize(cameraPosition - vWP);
    float fr = pow(1.0 - abs(dot(N,V)), 2.0);
    float lines = clamp(fwidth(vFold)*9.0, 0.0, 1.0)*smoothstep(0.3, 0.8, vFold);
    float thread; vec3 act = activity(thread);
    vec3 col = CY*(pow(fr,3.0)*0.12 + 0.005 + lines*0.018) + act*0.06;
    float near = smoothstep(0.15, 0.95, length(cameraPosition - vWP));
    gl_FragColor = vec4(safe(col*uHolo*near), 1.0);
  }`
});

/* ---------- neuron forest ---------- */
const neuronGroup = new THREE.Group(); scene.add(neuronGroup);
const tubePos = [], tubeNrm = [], tubeT = [], tubeR = [], tubeIdx = [];
const bulbs = [];
function addTube(curve, r0, r1, t0, t1, onRoute){
  const segs = 10, rad = 8, start = tubePos.length/3;
  const frames = curve.computeFrenetFrames(segs, false);
  for (let i=0;i<=segs;i++){
    const u = i/segs, p = curve.getPointAt(u), r = lerp(r0, r1, u);
    const N = frames.normals[i], B = frames.binormals[i];
    for (let j=0;j<rad;j++){
      const a = j/rad*Math.PI*2, ca = Math.cos(a), sa = Math.sin(a);
      const nx = N.x*ca + B.x*sa, ny = N.y*ca + B.y*sa, nz = N.z*ca + B.z*sa;
      tubePos.push(p.x + nx*r, p.y + ny*r, p.z + nz*r); tubeNrm.push(nx,ny,nz); tubeT.push(lerp(t0,t1,u)); tubeR.push(onRoute ? 1 : 0);
    }
  }
  for (let i=0;i<segs;i++) for (let j=0;j<rad;j++){
    const a = start + i*rad + j, b = start + i*rad + (j+1)%rad, c = a + rad, d = b + rad;
    tubeIdx.push(a,c,b, b,c,d);
  }
}
const _p = new THREE.Vector3();
function branch(p, dir, len, r, depth, tAcc){
  let end = p.clone().addScaledVector(dir, len);
  if (!inside(end) || !inside(_p.copy(p).lerp(end, .5))){
    len *= 0.55; end = p.clone().addScaledVector(dir, len);
    if (len < 0.025 || !inside(end)) return null;
  }
  const side = new THREE.Vector3(sr(-1,1), sr(-1,1), sr(-1,1)).cross(dir).normalize();
  const mid = p.clone().lerp(end, .5).addScaledVector(side, len*sr(.08,.2));
  const node = {kids:[], len, r, tAcc, curve: new THREE.QuadraticBezierCurve3(p.clone(), mid, end)};
  const t1 = tAcc + len;
  if (depth > 0 && len >= 0.03){
    if (srand() < .45) bulbs.push({p: node.curve.getPointAt(sr(.2,.5)), s: sr(4,7)});
    if (srand() < .3) bulbs.push({p: node.curve.getPointAt(sr(.55,.9)), s: sr(4,7)});
    const kids = depth > 3 ? 2 : (srand() < .5 ? 2 : 3);
    for (let k=0;k<kids;k++){
      const axis = new THREE.Vector3(sr(-1,1), sr(-1,1), sr(-1,1)).normalize();
      const nd = dir.clone().applyAxisAngle(axis, sr(.35,.85)).normalize();
      nd.y += 0.15; nd.normalize();
      const kid = branch(end, nd, len*sr(.62,.8), r*0.66, depth-1, t1);
      if (kid) node.kids.push(kid);
    }
  }
  if (!node.kids.length) bulbs.push({p: end, s: sr(9,15)});
  return node;
}
function emit(node, routeSet){
  addTube(node.curve, node.r, node.r*0.72, node.tAcc, node.tAcc + node.len, routeSet.has(node));
  node.kids.forEach(k => emit(k, routeSet));
}
function rootAt(x, z){
  for (let y=-0.8; y<0.4; y+=0.01){
    if (inside(_p.set(x,y,z)) && inside(_p.set(x,y+0.05,z)) && inside(_p.set(x,y+0.1,z))) return new THREE.Vector3(x, y+0.02, z);
  }
  return null;
}

/* ---------- neural tissue all around you once inside (baked once, so it costs nothing per frame) ---------- */
function bakeTissue(){
  const big = Math.min(innerWidth, innerHeight) > 600;
  const rt = new THREE.WebGLRenderTarget(big ? 4096 : 2048, big ? 2048 : 1024,
    {minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false, wrapS: THREE.RepeatWrapping, depthBuffer: false});
  const q = new THREE.Mesh(new THREE.PlaneGeometry(2,2), new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: GLSL_NOISE + `
      varying vec2 vUv;
      void main(){
        float phi = vUv.x*6.28318530718, th = (1.0 - vUv.y)*3.14159265359;
        vec3 d = vec3(-cos(phi)*sin(th), cos(th), sin(phi)*sin(th));
        vec3 w = vec3(snoise(d*1.6 + 3.0), snoise(d*1.6 + 7.0), snoise(d*1.6 + 11.0))*0.35;
        float n = snoise(d*4.2 + w);
        float h = pow(smoothstep(0.0, 0.42, abs(n)), 0.7);
        float v = snoise(d*2.4 + vec3(5.0) + w*0.8);
        float line = 1.0 - smoothstep(0.0, 0.02, abs(v));
        float sul = 1.0 - smoothstep(0.0, 0.05, abs(n));
        gl_FragColor = vec4(h, line, sul, 1.0);
      }`
  }));
  const s = new THREE.Scene(); s.add(q);
  renderer.setRenderTarget(rt); renderer.render(s, new THREE.Camera()); renderer.setRenderTarget(null);
  q.geometry.dispose(); q.material.dispose();
  return rt.texture;
}
const skyU = { uMap:{value:null}, uVis:{value:0}, uTN:{value:0}, uRingA:{value:0}, uRingS:{value:0}, uOrbDir:{value:new THREE.Vector3(0,0,1)} };
const sky = new THREE.Mesh(new THREE.SphereGeometry(3.2, 96, 64), new THREE.ShaderMaterial({
  side: THREE.BackSide, transparent: true, depthWrite: false, uniforms: skyU,
  vertexShader: `varying vec2 vUv; varying vec3 vD; varying vec3 vWD;
    void main(){ vUv = uv; vD = position; vec4 wp = modelMatrix*vec4(position,1.0); vWD = wp.xyz - cameraPosition; gl_Position = projectionMatrix*viewMatrix*wp; }`,
  fragmentShader: GLSL_COMMON + `
    uniform sampler2D uMap; uniform float uVis, uTN, uRingA, uRingS; uniform vec3 uOrbDir;
    varying vec2 vUv; varying vec3 vD; varying vec3 vWD;
    void main(){
      vec4 m = texture2D(uMap, vUv); float h = m.r, line = m.g, sul = m.b;
      vec3 d = normalize(vD);
      vec3 col = mix(vec3(0.002,0.013,0.015), vec3(0.016,0.09,0.095), h);
      col += CY*0.035*smoothstep(0.4,1.0,h)*(0.5 + 0.5*d.y);
      float travel = pow(0.5 + 0.5*sin(dot(d, vec3(9.0,13.0,7.0)) - uTN*2.4), 6.0);
      col += CY*line*(0.05 + 0.45*travel);
      col += CY*0.06*sul*(0.5 + 0.5*sin(uTN*1.3 + d.x*8.0));
      // detection wave sweeping across the surrounding tissue
      float ang = acos(clamp(dot(normalize(vWD), uOrbDir), -1.0, 1.0));
      float ring = exp(-pow((ang - uRingA)/0.075, 2.0))*uRingS;
      col += GOLD*ring*(0.03 + 0.22*h + 0.8*line + 0.25*sul);
      gl_FragColor = vec4(safe(col), uVis);
    }`
}));
sky.renderOrder = -1; sky.frustumCulled = false; scene.add(sky);

/* ---------- point sprites ---------- */
const spriteVS = `attribute float aSize; attribute vec3 aCol; attribute float aAlpha;
  uniform float uScale; uniform float uMax; varying vec3 vCol; varying float vA;
  void main(){ vCol = aCol; vec4 mv = modelViewMatrix*vec4(position,1.0);
    vA = aAlpha * smoothstep(0.03, 0.2, -mv.z);
    gl_PointSize = min(aSize*uScale / max(-mv.z, 0.001), uMax); gl_Position = projectionMatrix*mv; }`;
const spriteFS = GLSL_COMMON + `uniform float uVis; varying vec3 vCol; varying float vA;
  void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c);
    float core = smoothstep(0.17, 0.0, d); float halo = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(safe(vCol*(core*1.4 + halo*halo*0.6)*vA*uVis), 1.0); }`;
const spriteMat = () => new THREE.ShaderMaterial({ uniforms:{uScale:{value:300}, uMax:{value:40}, uVis:{value:0}},
  vertexShader:spriteVS, fragmentShader:spriteFS, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending });
function points(n, mat, order){
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n*3),3));
  g.setAttribute('aSize', new THREE.Float32BufferAttribute(new Float32Array(n),1));
  g.setAttribute('aCol', new THREE.Float32BufferAttribute(new Float32Array(n*3),3));
  g.setAttribute('aAlpha', new THREE.Float32BufferAttribute(new Float32Array(n),1));
  const p = new THREE.Points(g, mat); p.renderOrder = order; p.frustumCulled = false; return p;
}

/* ---------- build everything that depends on the model ---------- */
let brainSolid, brainHolo, tubes, tubeU, bulbPts, bulbMat, NB, bulbTw, bulbBase;
let route, routeLen, stopS, orb, orbMat, sparks, sparkMat, sparkDir, dust, dustMat;
const TRAIL = 16, NS = 70;
const CAM_END = new THREE.Vector3(0, -0.02, -0.24), VIEW = new THREE.Vector3(0, 0.03, 1).normalize();
const TILT = new THREE.Matrix4().makeRotationX(0.08);
function routePoint(sd, out){
  sd = clamp(sd, 0, routeLen);
  for (const n of route){ if (sd <= n.len) return out.copy(n.curve.getPointAt(sd/n.len)); sd -= n.len; }
  return out.copy(route[route.length-1].curve.getPointAt(1));
}
function buildNeurons(){
  const heroRoot = rootAt(0.03, 0.30) || new THREE.Vector3(0.03, -0.3, 0.30);
  const hero = branch(heroRoot, new THREE.Vector3(0,1,0.05).normalize(), 0.28, 0.022, 6, 0);
  const trees = [hero];
  [[-0.34,0.05],[0.36,-0.02],[-0.22,0.52],[0.26,0.55],[-0.42,-0.35],[0.42,-0.38],[0.0,-0.5]].forEach(([x,z]) => {
    const r = rootAt(x, z); if (!r) return;
    const t = branch(r, new THREE.Vector3(sr(-.3,.3), 1, sr(-.3,.3)).normalize(), sr(.16,.22), sr(.014,.02), 5, 0);
    if (t) trees.push(t);
  });
  // the stem the golden memory travels: trunk to the tip that sits most centrally in the final view
  let best = 1e9;
  (function walk(n, path){
    const p = [...path, n];
    if (!n.kids.length){
      const e = n.curve.getPointAt(1).clone().applyMatrix4(TILT).sub(CAM_END);
      const d = 2.2*Math.abs(Math.atan2(e.x, e.z)) + Math.abs(Math.atan2(e.y, e.z) - 0.03) + (e.length() < 0.5 ? (0.5 - e.length())*3 : 0);
      if (d < best){ best = d; route = p; } return;
    }
    n.kids.forEach(k => walk(k, p));
  })(hero, []);
  routeLen = route.reduce((a,n) => a + n.len, 0);
  stopS = routeLen; let bs = 9; const q = new THREE.Vector3();
  for (let i=20;i<=200;i++){ const sd = routeLen*i/200; routePoint(sd, q); q.applyMatrix4(TILT).sub(CAM_END);
    const sc = 2.2*Math.abs(Math.atan2(q.x, q.z)) + Math.abs(Math.atan2(q.y, q.z) - 0.03) + (q.length() < 0.45 ? 1 : 0); if (sc < bs){ bs = sc; stopS = sd; } }
  const routeSet = new Set(route);
  trees.forEach(t => emit(t, routeSet));

  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.Float32BufferAttribute(tubePos,3));
  tg.setAttribute('normal', new THREE.Float32BufferAttribute(tubeNrm,3));
  tg.setAttribute('aT', new THREE.Float32BufferAttribute(tubeT,1));
  tg.setAttribute('aRoute', new THREE.Float32BufferAttribute(tubeR,1));
  tg.setIndex(tubeIdx);
  tubeU = { uTN:{value:0}, uVis:{value:0}, uWaveC:{value:new THREE.Vector3()}, uWaveR:{value:0}, uWaveA:{value:0},
            uTraceS:{value:0}, uTrace:{value:0}, uConv:{value:0}, uStopS:{value:stopS} };
  tubes = new THREE.Mesh(tg, new THREE.ShaderMaterial({
    uniforms: tubeU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float aT; attribute float aRoute; varying float vT; varying float vR; varying vec3 vN; varying vec3 vWP; varying vec3 vObj;
      void main(){ vT = aT; vR = aRoute; vObj = position; vN = mat3(modelMatrix)*normal; vec4 wp = modelMatrix*vec4(position,1.0); vWP = wp.xyz; gl_Position = projectionMatrix*viewMatrix*wp; }`,
    fragmentShader: GLSL_COMMON + `
      uniform float uTN, uVis, uWaveR, uWaveA, uTraceS, uTrace, uConv, uStopS; uniform vec3 uWaveC;
      varying float vT; varying float vR; varying vec3 vN; varying vec3 vWP; varying vec3 vObj;
      void main(){
        vec3 V = normalize(cameraPosition - vWP); float fr = pow(1.0 - abs(dot(safeN(vN), V)), 1.6);
        float pulse = pow(fract(vT*2.2 - uTN*0.55), 36.0) + 0.6*pow(fract(vT*3.7 - uTN*0.9 + 0.4), 44.0);
        float near = smoothstep(0.06, 0.32, length(cameraPosition - vWP));
        vec3 col = CY*(0.05 + fr*0.45) + MINT*pulse*0.7;
        // the path the memory took lights up behind it
        float path = vR*(1.0 - smoothstep(uTraceS - 0.012, uTraceS + 0.004, vT))*uTrace;
        col = mix(col, col*0.4, path) + GOLD*path*(0.07 + fr*0.85);
        // energy streaming along that path into the found memory
        float conv = vR*step(vT, uStopS)*pow(fract(vT*7.0 - uTN*1.6), 16.0)*uConv;
        col += GOLDW*conv*1.3;
        // detection shockwave rolling through the network
        float dw = length(vObj - uWaveC) - uWaveR;
        col += GOLD*exp(-dw*dw/0.0011)*uWaveA*(0.7 + fr);
        gl_FragColor = vec4(safe(col*uVis*near), 1.0);
      }`
  }));
  tubes.renderOrder = 1; tubes.frustumCulled = false; neuronGroup.add(tubes);

  NB = bulbs.length;
  bulbMat = spriteMat(); bulbPts = points(NB, bulbMat, 1);
  const bp = bulbPts.geometry.attributes;
  bulbs.forEach((b,i) => { bp.position.setXYZ(i, b.p.x, b.p.y, b.p.z); bp.aSize.setX(i, b.s); bp.aCol.setXYZ(i, ...CYA); bp.aAlpha.setX(i, 1); });
  bulbTw = bulbs.map(() => rand(0, Math.PI*2));
  neuronGroup.add(bulbPts);

  // faint dust floating in the space around you
  const DUST = 220; dustMat = spriteMat(); dust = points(DUST, dustMat, 1);
  const da = dust.geometry.attributes; let n = 0;
  while (n < DUST){ _p.set(rand(-0.6,0.6), rand(-0.45,0.55), rand(-0.8,0.8)); if (!inside(_p)) continue;
    da.position.setXYZ(n, _p.x, _p.y, _p.z); da.aSize.setX(n, rand(1.5,3.5)); da.aCol.setXYZ(n, ...CYA); da.aAlpha.setX(n, .5); n++; }
  neuronGroup.add(dust);

  // the golden memory: halo, core, and a trail
  orbMat = spriteMat(); orb = points(TRAIL + 2, orbMat, 3);
  const oa = orb.geometry.attributes;
  oa.aSize.setX(0, 34); oa.aSize.setX(1, 18); oa.aCol.setXYZ(0, 1,.62,.26); oa.aCol.setXYZ(1, 1,.8,.5); oa.aAlpha.setX(0,.55); oa.aAlpha.setX(1,1);
  for (let i=0;i<TRAIL;i++){ oa.aSize.setX(i+2, 12*(1 - i/TRAIL) + 3); oa.aCol.setXYZ(i+2, 1,.6,.25); oa.aAlpha.setX(i+2, .8*Math.pow(1 - i/TRAIL, 1.5)); }
  neuronGroup.add(orb);

  // spark burst on detection
  sparkMat = spriteMat(); sparks = points(NS, sparkMat, 3);
  const sa = sparks.geometry.attributes; sparkDir = [];
  for (let i=0;i<NS;i++){
    const d = new THREE.Vector3(rand(-1,1), rand(-1,1), rand(-1,1)).normalize();
    sparkDir.push({d, sp: rand(0.18, 0.5), up: rand(0.0, 0.05)});
    sa.aSize.setX(i, rand(5, 11)); sa.aCol.setXYZ(i, ...(Math.random() < .3 ? [1,.85,.6] : GOLDA)); sa.aAlpha.setX(i, 1);
  }
  neuronGroup.add(sparks);
}

/* ---------- layout + adaptive quality ---------- */
let W, H, DPR, dist = 4.2, qDPR = Math.min(window.devicePixelRatio || 1, 1.75), drops = 0;
function applySize(){
  DPR = qDPR;
  renderer.setPixelRatio(DPR); renderer.setSize(W, H, false); composer.setPixelRatio(DPR); composer.setSize(W, H);
  glc.style.width = hud.style.width = W+'px'; glc.style.height = hud.style.height = H+'px';
  hud.width = Math.round(W*DPR); hud.height = Math.round(H*DPR);
  const scale = H*DPR*0.5 / Math.tan(THREE.MathUtils.degToRad(36/2));
  [bulbMat, dustMat, orbMat, sparkMat].forEach(m => { if (!m) return; m.uniforms.uScale.value = scale*0.0021; m.uniforms.uMax.value = 30*DPR; });
  if (orbMat) orbMat.uniforms.uMax.value = 90*DPR;
}
function layout(){
  const r = stage.getBoundingClientRect(); W = Math.max(1, r.width); H = Math.max(1, r.height);
  camera.aspect = W/H;
  camera.setViewOffset(W, H, 0, H*0.06, W, H);
  camera.updateProjectionMatrix();
  const aspect = W/H;
  dist = aspect < 1 ? 4.2/Math.max(aspect,.45)*0.9 : 4.2;
  applySize();
}

/* ---------- timeline ---------- */
const PHASES = [
  {a:0,    b:2.6,  sub:'Looking for what you asked about'},
  {a:2.6,  b:5.8,  sub:'Going deeper'},
  {a:5.8,  b:LOCK, sub:'Tracking a memory'},
  {a:LOCK, b:11.0, sub:'Found a match', gold:true},
  {a:11.0, b:13.6, sub:'Bringing it back'},
  {a:13.6, b:LOOP, sub:'Looking for what you asked about'}
];
PHASES.forEach(p => { const i = document.createElement('i'); i.style.width = ((p.b-p.a)*6.2)+'px'; i.innerHTML = '<b></b>'; phaseEl.appendChild(i); p.bar = i.firstChild; });
let curPhase = -1;
function setSub(p){
  if (subEl.textContent === p.sub) return;
  subEl.classList.add('out');
  setTimeout(() => { subEl.textContent = p.sub; subEl.classList.toggle('gold', !!p.gold); subEl.classList.remove('out'); }, 250);
}
const YAW0 = 1.15;
function state(lt){
  const yaw = YAW0*(1 - easeSine(seg(lt,0,3.4))) + YAW0*easeSine(seg(lt,13.2,LOOP));
  // one continuous camera move: accelerate in, glide through the surface, keep drifting inside
  const p = seg(lt,2.6,11.2);
  const g = (1 - Math.pow(1-p, 4)) * smooth(Math.min(p/0.3, 1));
  const back = easeSine(seg(lt,11.0,13.7));
  const zIn = lerp(-dist, -0.24, g), z = lerp(zIn, -dist, back);
  const a = lt - LOCK;
  return {
    yaw, z,
    dd: clamp((z + dist)/(dist - 0.24), 0, 1),
    sway: smooth(seg(z,-0.9,-0.45)),
    dis: smooth(seg(z,-3.2,-1.35)),
    holo: smooth(seg(z,-3.3,-2.4))*(1 - smooth(seg(z,-1.6,-0.95))),
    bg: smooth(seg(z,-1.05,-0.6)),
    neu: smooth(seg(z,-3.4,-1.9)),
    orbS: easeInOut(seg(lt,5.9,LOCK)),
    orbVis: smooth(seg(lt,5.6,6.2))*(1 - smooth(seg(lt,10.9,11.6))),
    track: smooth(seg(lt,6.4,7.0)),
    lock: seg(lt,LOCK,LOCK+0.45), lockFade: 1 - seg(lt,10.5,11.2),
    focus: smooth(seg(lt,LOCK,LOCK+0.9))*(1 - smooth(seg(lt,10.5,11.6))),
    slow: smooth(seg(lt,LOCK-0.05,LOCK+0.25))*(1 - smooth(seg(lt,LOCK+0.8,LOCK+1.5))),
    trace: smooth(seg(lt,5.9,6.3))*(1 - smooth(seg(lt,10.4,11.2))),
    conv: smooth(seg(lt,LOCK+0.1,LOCK+0.6))*(1 - smooth(seg(lt,10.2,10.9))),
    waveR: easeOut(seg(a,0.05,1.7))*0.95, waveA: a > 0.05 ? Math.pow(1 - seg(a,0.05,1.7), 1.2) : 0,
    ringA: easeOut(seg(a,0.05,1.9))*1.7, ringS: a > 0.05 ? (1 - seg(a,0.05,1.9))*0.6 : 0,
    sparkAge: a,
    goldZ: lerp(1.05, -1.1, seg(lt,11.2,13.6)), gold: Math.sin(Math.PI*seg(lt,11.2,13.6)),
    glow: 0.4*Math.exp(-Math.pow((lt-14.0)/0.4,2))
  };
}

/* ---------- loop ---------- */
let time = 0, tN = 0, last = 0, paused = false, ema = 16, lastMs = 0;
// Recall: the brain is alive (floating, neural flicker) from the start, but
// the journey inside only runs while a conversation is on. "clock" drives
// the motion; "time" drives the journey. Asked to stop, the journey
// finishes its loop — which ends where it began — and holds there.
let clock = 0, journey = false, holdAt = 0;
// Between journeys the brain rests for a few seconds — still floating and
// flickering — so a long conversation isn't one unbroken fly-through.
const REST = 3.5;
let restUntil = -1;
window.recallSetPlaying = (on) => {
  if (on){ journey = true; }
  else if (journey){ journey = false; restUntil = -1; holdAt = Math.ceil(time / LOOP - 1e-6) * LOOP; }
};
// Recall's Ask screen: the brain on its own, calm, to be touched. Drag
// turns it (with a little momentum that settles); a tap sends a soft pulse
// through it; untouched it drifts round very slowly. No journey here.
let interactive = false, spinY = 0, spinX = 0, velY = 0, velX = 0, dragging = false, px = 0, py = 0, pulse = 0;
window.recallSetInteractive = (on) => { interactive = !!on; stage.style.touchAction = on ? 'none' : ''; };
stage.addEventListener('pointerdown', (e) => {
  if (!interactive) return;
  dragging = true; px = e.clientX; py = e.clientY; velY = velX = 0; pulse = 1;
});
addEventListener('pointermove', (e) => {
  if (!interactive || !dragging) return;
  const dx = e.clientX - px, dy = e.clientY - py; px = e.clientX; py = e.clientY;
  velY = dx*0.008; velX = dy*0.004;
  spinY += velY; spinX = clamp(spinX + velX, -0.45, 0.45);
});
addEventListener('pointerup', () => { dragging = false; });
addEventListener('pointercancel', () => { dragging = false; });
if (location.hash.includes('ask')) window.recallSetInteractive(true);
// For making still images of the brain (the app's icons): step the scene to
// a moment and turn, draw it, hand back a PNG. Works in a hidden page too.
window.recallStill = (seconds = 3, turn = 0) => {
  spinY = turn; velY = velX = 0; pulse = 0;
  let ms = last || performance.now();
  for (let i = 0; i < seconds*60; i++){ ms += 1000/60; frame(ms); }
  spinY = turn;
  frame(ms + 1000/60);
  return glc.toDataURL('image/png');
};
const hm = location.hash.match(/t=([\d.]+)/); let freezeAt = null;

if (hm){ freezeAt = parseFloat(hm[1]); time = Math.max(0, freezeAt - 0.1); tN = time; }
$('pp').onclick = () => { paused = !paused; $('pp').textContent = paused ? 'Play' : 'Pause'; $('pp').setAttribute('aria-label', paused ? 'Play animation' : 'Pause animation'); };
const tmpV = new THREE.Vector3(), look = new THREE.Vector3(), tgt = new THREE.Vector3(), orbPos = new THREE.Vector3(), orbTmp = new THREE.Vector3(), orbW = new THREE.Vector3();
function project(v){ tmpV.copy(v).project(camera); return {x:(tmpV.x*.5+.5)*W, y:(-tmpV.y*.5+.5)*H, z:tmpV.z}; }

function frame(ms){
  requestAnimationFrame(frame);
  const real = ms - lastMs; lastMs = ms;
  let dt = Math.min(.05, (ms-last)/1000) * SPEED; last = ms;
  if (freezeAt !== null) dt = Math.min(1/60, Math.max(0, freezeAt - time));
  if (paused) dt = 0;
  clock += dt;
  if (!journey){
    time += Math.min(dt, Math.max(0, holdAt - time));
  } else if (clock < restUntil){
    // resting at the start of the loop: motion only
  } else {
    const end = (Math.floor(time / LOOP + 1e-6) + 1) * LOOP;
    if (time + dt >= end){ time = end; restUntil = clock + REST; }
    else time += dt;
  }
  const t = clock, lt = time % LOOP, st = state(lt);
  tN += dt*(1 - 0.65*st.slow);              // neural time slows for a beat on detection

  // quality guard: if frames are consistently slow, drop resolution during the calm opening only
  if (freezeAt === null && !paused){ ema = ema*0.95 + real*0.05;
    if (ema > 26 && lt < 2.0 && drops < 2 && qDPR > 1){ qDPR = Math.max(1, qDPR - 0.375); drops++; applySize(); ema = 16; } }

  // brain: turns from a side view to face you, gentle float
  const idle = 1 - st.dd;
  if (interactive && !dragging){
    // momentum dies away; it then drifts on very slowly by itself, and tips
    // back level
    velY *= Math.exp(-dt*2.2); velX *= Math.exp(-dt*3);
    spinY += velY + dt*0.09; spinX += velX; spinX *= Math.exp(-dt*0.8);
  }
  pulse *= Math.exp(-dt*1.6);
  brainSolid.rotation.set(0.08 + spinX + Math.sin(t*.3)*0.04*idle, st.yaw + spinY + Math.sin(t*.27)*0.05*idle, 0);
  brainSolid.position.y = Math.sin(t*.8)*0.025*idle;
  brainHolo.rotation.copy(brainSolid.rotation); brainHolo.position.copy(brainSolid.position);
  neuronGroup.rotation.copy(brainSolid.rotation); neuronGroup.position.copy(brainSolid.position);
  U.uTime.value = t; U.uTN.value = tN; U.uDis.value = st.dis; U.uAct.value = 1 - 0.8*smooth(clamp(st.dis*1.6, 0, 1));
  U.uHolo.value = st.holo*(1 - st.bg); U.uGold.value = st.gold; U.uGoldZ.value = st.goldZ; U.uGlow.value = st.glow + 0.9*pulse;
  brainSolid.visible = st.dis < 0.999;
  brainHolo.visible = U.uHolo.value > 0.002;

  // golden memory travelling up one stem
  const sd = st.orbS*stopS, oa = orb.geometry.attributes, op = oa.position;
  routePoint(sd, orbPos);
  const moving = st.orbS > 0 && st.orbS < 1 ? 1 : 0.12;
  op.setXYZ(0, orbPos.x, orbPos.y, orbPos.z); op.setXYZ(1, orbPos.x, orbPos.y, orbPos.z);
  for (let k=0;k<TRAIL;k++){ routePoint(sd - (k+1)*0.014*moving, orbTmp); op.setXYZ(k+2, orbTmp.x, orbTmp.y, orbTmp.z); }
  op.needsUpdate = true;
  const L = st.lock*st.lockFade;
  oa.aSize.setX(0, (34 + 22*L)*(1 + 0.18*Math.sin(t*6)*L)); oa.aSize.setX(1, 18 + 6*L); oa.aSize.needsUpdate = true;
  orbMat.uniforms.uVis.value = st.orbVis;
  orbW.copy(orbPos); neuronGroup.updateMatrixWorld(); neuronGroup.localToWorld(orbW);

  // camera: straight in through the back of the brain, then a focus push onto the memory
  const sway = st.sway;
  camera.position.set(Math.sin(t*.4)*0.05*sway, lerp(0.12, -0.02, st.dd) + Math.cos(t*.33)*0.03*sway, st.z);
  look.set(camera.position.x*0.5, lerp(0, 0.04, sway), camera.position.z + 1.5);
  if (st.track > 0) look.lerp(orbW, 0.35*st.track*st.orbVis*(1 - st.focus));
  if (st.focus > 0){
    camera.position.lerp(orbW, 0.12*st.focus);
    look.lerp(orbW, 0.85*st.focus);
  }
  camera.lookAt(look);
  camera.rotateZ(Math.sin(t*.22)*0.035*sway*(1 - st.focus));
  camera.fov = 36 - 5*st.focus; camera.updateProjectionMatrix();

  // inside world
  const showN = st.neu > 0.001 || st.orbVis > 0.001;
  neuronGroup.visible = showN;
  tubeU.uTN.value = tN; tubeU.uVis.value = st.neu*(1 - 0.3*st.track*st.lockFade);
  tubeU.uWaveC.value.copy(orbPos); tubeU.uWaveR.value = st.waveR; tubeU.uWaveA.value = st.waveA;
  tubeU.uTraceS.value = sd; tubeU.uTrace.value = st.trace; tubeU.uConv.value = st.conv;
  bulbMat.uniforms.uVis.value = st.neu; dustMat.uniforms.uVis.value = st.bg*0.8;
  sky.position.copy(camera.position); sky.rotation.y = tN*0.01;
  sky.visible = st.bg > 0.002;
  skyU.uVis.value = st.bg*(1 - 0.25*st.track*st.lockFade); skyU.uTN.value = tN;
  skyU.uOrbDir.value.copy(orbW).sub(camera.position).normalize(); skyU.uRingA.value = st.ringA; skyU.uRingS.value = st.ringS;

  if (showN){
    const ba = bulbPts.geometry.attributes;
    for (let i=0;i<NB;i++){
      let a = .3 + .6*Math.pow(.5 + .5*Math.sin(tN*2.2 + bulbTw[i]), 3), s = bulbs[i].s, cr = CYA[0], cg = CYA[1], cb = CYA[2];
      if (st.waveA > 0){
        const d = bulbs[i].p.distanceTo(orbPos) - st.waveR, w = Math.exp(-d*d/0.0018)*st.waveA;
        cr = lerp(cr, GOLDA[0], w); cg = lerp(cg, GOLDA[1], w); cb = lerp(cb, GOLDA[2], w); a = Math.min(1, a + w); s += 8*w;
      }
      ba.aAlpha.setX(i, a); ba.aSize.setX(i, s); ba.aCol.setXYZ(i, cr, cg, cb);
    }
    ba.aAlpha.needsUpdate = ba.aSize.needsUpdate = ba.aCol.needsUpdate = true;
  }

  // spark burst
  const age = st.sparkAge;
  if (age > 0 && age < 1.6){
    const sa = sparks.geometry.attributes, k = 3.0, e = (1 - Math.exp(-k*age))/k;
    for (let i=0;i<NS;i++){ const s = sparkDir[i];
      sa.position.setXYZ(i, orbPos.x + s.d.x*s.sp*e, orbPos.y + s.d.y*s.sp*e + s.up*age, orbPos.z + s.d.z*s.sp*e); }
    sa.position.needsUpdate = true;
    sparkMat.uniforms.uVis.value = Math.pow(1 - age/1.6, 2)*st.orbVis;
    sparks.visible = true;
  } else sparks.visible = false;

  bloom.strength = (0.6 + 0.05*st.bg)*(1 - 0.4*st.holo) + 0.2*Math.exp(-Math.pow((lt - LOCK - 0.15)/0.35, 2));

  composer.render();
  drawHUD(st, lt, t);

  const pi = PHASES.findIndex(p => lt >= p.a && lt < p.b);
  if (pi !== curPhase){ curPhase = pi; setSub(PHASES[pi]); }
  PHASES.forEach((p,i) => { p.bar.style.width = (i < pi ? 100 : i === pi ? seg(lt,p.a,p.b)*100 : 0) + '%'; });
}

/* ---------- detection overlay ---------- */
const GOLDS = (a) => `rgba(255,196,128,${a})`;
function drawHUD(st, lt, t){
  const c = hctx; c.setTransform(DPR,0,0,DPR,0,0); c.clearRect(0,0,W,H);
  if (st.track <= 0 || st.orbVis <= 0.01 || st.lockFade <= 0) return;
  tgt.copy(orbW); const T = project(tgt);
  if (T.z >= 1 || T.z <= -1) return;
  const fade = st.track*st.lockFade*st.orbVis, k = st.lock, a = lt - LOCK;
  const prog = easeInOut(seg(lt, 6.4, LOCK));

  // soft warm bloom on screen around the find
  if (a > 0){
    const gA = 0.12*Math.exp(-Math.pow((a - 0.25)/0.5, 2))*fade + 0.04*fade;
    const g = c.createRadialGradient(T.x, T.y, 0, T.x, T.y, 240);
    g.addColorStop(0, GOLDS(gA)); g.addColorStop(1, GOLDS(0));
    c.fillStyle = g; c.fillRect(T.x - 240, T.y - 240, 480, 480);
  }

  // energy lines converging from surrounding synapses
  if (st.conv > 0){
    c.globalCompositeOperation = 'lighter';
    for (let i=0;i<14;i++){
      const b = bulbs[(i*37 + 11) % NB]; tmpV.copy(b.p); neuronGroup.localToWorld(tmpV);
      const n = project(tmpV); if (n.z >= 1 || n.z <= -1) continue;
      const f = (t*.75 + i*.137) % 1;
      c.strokeStyle = GOLDS(.08*st.conv*fade); c.lineWidth = 1;
      c.beginPath(); c.moveTo(n.x,n.y); c.lineTo(T.x,T.y); c.stroke();
      c.fillStyle = GOLDS(st.conv*fade*Math.sin(Math.PI*f));
      c.beginPath(); c.arc(lerp(n.x,T.x,easeIn(f)), lerp(n.y,T.y,easeIn(f)), 1.7, 0, Math.PI*2); c.fill();
    }
    c.globalCompositeOperation = 'source-over';
  }

  c.save(); c.translate(T.x, T.y);
  // tracking: dashed ring, sweeping arcs and a progress arc that fills as the signal is followed
  const pre = 1 - smooth(k);
  if (pre > 0.01){
    const R = lerp(62, 44, st.track);
    c.strokeStyle = GOLDS(.35*fade*pre); c.lineWidth = 1;
    c.setLineDash([3,6]); c.lineDashOffset = -t*30;
    c.beginPath(); c.arc(0,0,R,0,Math.PI*2); c.stroke(); c.setLineDash([]);
    c.save(); c.rotate(t*1.6);
    c.strokeStyle = GOLDS(.8*fade*pre); c.lineWidth = 1.6;
    c.beginPath(); c.arc(0,0,R,0,0.7); c.stroke();
    c.beginPath(); c.arc(0,0,R,Math.PI,Math.PI+0.7); c.stroke();
    c.restore();
    c.strokeStyle = GOLDS(.12*fade*pre); c.lineWidth = 2;
    c.beginPath(); c.arc(0,0,R+9,0,Math.PI*2); c.stroke();
    c.strokeStyle = GOLDS(.95*fade); c.lineWidth = 2; c.lineCap = 'round';
    c.beginPath(); c.arc(0,0,R+9,-Math.PI/2,-Math.PI/2 + Math.PI*2*prog); c.stroke(); c.lineCap = 'butt';
  }
  if (a > 0){
    // the completed ring pops outward
    const pp = seg(a, 0, 0.85);
    if (pp < 1){ c.strokeStyle = GOLDS(.9*Math.pow(1-pp,1.5)*fade); c.lineWidth = 2*(1-pp) + 0.5;
      c.beginPath(); c.arc(0,0,lerp(53, 140, easeOut(pp)),0,Math.PI*2); c.stroke(); }
    // crosshair lines shoot out to the edges, then fade
    const cl = easeOut(seg(a, 0, 0.45)), ca = (1 - seg(a, 0.45, 1.7))*fade;
    if (ca > 0.01){
      const maxL = Math.max(W, H)*0.7;
      for (let q=0;q<4;q++){
        const ang = q*Math.PI/2, dx = Math.cos(ang), dy = Math.sin(ang), r0 = 34, r1 = r0 + cl*maxL;
        const g = c.createLinearGradient(dx*r0, dy*r0, dx*r1, dy*r1);
        g.addColorStop(0, GOLDS(.65*ca)); g.addColorStop(1, GOLDS(0));
        c.strokeStyle = g; c.lineWidth = 1;
        c.beginPath(); c.moveTo(dx*r0, dy*r0); c.lineTo(dx*r1, dy*r1); c.stroke();
      }
    }
    // a slow tick ring that stays on while it's locked
    const ta = smooth(seg(a, 0.25, 0.8))*fade;
    if (ta > 0.01){
      c.save(); c.rotate(t*0.35);
      for (let i=0;i<36;i++){
        const an = i/36*Math.PI*2, long = i % 9 === 0, r0 = 46, r1 = long ? 54 : 49;
        c.strokeStyle = GOLDS((long ? .85 : .4)*ta); c.lineWidth = long ? 1.6 : 1;
        c.beginPath(); c.moveTo(Math.cos(an)*r0, Math.sin(an)*r0); c.lineTo(Math.cos(an)*r1, Math.sin(an)*r1); c.stroke();
      }
      c.restore();
    }
    // ripples
    for (const r0 of [0.45, 0.95]){
      const rp = seg(a, r0, r0 + 1.1);
      if (rp > 0 && rp < 1){ c.strokeStyle = GOLDS(.55*(1-rp)*fade); c.lineWidth = 1.2;
        c.beginPath(); c.arc(0,0, 14 + 90*easeOut(rp), 0, Math.PI*2); c.stroke(); }
    }
  }
  // brackets snap shut on lock
  const bk = easeOutBack(clamp(k,0,1)), s2 = lerp(64, 27, bk), ang = (1 - easeOut(k))*Math.PI/4;
  c.rotate(ang + Math.sin(t*1.5)*0.03*k);
  c.strokeStyle = GOLDS(fade*(0.4 + 0.6*k)); c.lineWidth = 2;
  for (let q=0;q<4;q++){ c.rotate(Math.PI/2); c.beginPath(); c.moveTo(s2, s2-9); c.lineTo(s2,s2); c.lineTo(s2-9,s2); c.stroke(); }
  c.restore();
}

/* ---------- start ---------- */
(async () => {
  try {
    const [geo] = await Promise.all([loadBrain(), loadVox()]);
    brainSolid = new THREE.Mesh(geo, solidMat); brainSolid.renderOrder = 0; scene.add(brainSolid);
    brainHolo = new THREE.Mesh(geo, holoMat); brainHolo.renderOrder = 2; scene.add(brainHolo);
    buildNeurons();
    skyU.uMap.value = bakeTissue();
    layout();
    // compile every shader up front so nothing hitches the first time it appears
    scene.traverse(o => { o.visible = true; });
    try { await renderer.compileAsync(scene, camera); } catch(e){ renderer.compile(scene, camera); }
    composer.render();
    glc.classList.add('on');
    msg.style.opacity = 0; setTimeout(() => msg.remove(), 700);
    requestAnimationFrame(ms => { last = lastMs = ms; frame(ms); });
  } catch(e){ msg.textContent = 'Couldn’t load the brain model.'; console.error(e); }
})();
let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(layout, 80); });
