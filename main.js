import * as THREE from 'three';

/* ============================================================
 * 1. CONSTANTS
 * ============================================================ */
const TOTAL_ROUNDS   = 5;
const MIN_DELAY      = 1500;   // ms — minimum wait before GO
const MAX_DELAY      = 4000;   // ms — maximum wait before GO
const PARTICLE_COUNT = 420;
const PARTICLE_INNER = 1.5;    // min radius of initial sphere distribution
const PARTICLE_OUTER = 3.0;    // max radius
const BURST_SPEED    = 3.4;    // multiplier of base radius on react
const BURST_DURATION = 400;    // ms to complete burst
const LERP_FACTOR    = 0.08;   // per-frame interpolation for colors/scale (~300ms to converge)
const PARTICLE_LERP  = 0.07;   // per-frame for particle idle/settle
const RATING_THRESHOLDS = {
  lightning: 200,
  sharp:     300,
  average:   450,
};
const STATE_COLORS = {
  idle:          { geo: '#7F77DD', particle: '#534AB7', light: '#7F77DD' },
  waiting:       { geo: '#534AB7', particle: '#3C3489', light: '#AFA9EC' },
  react:         { geo: '#1D9E75', particle: '#5DCAA5', light: '#1D9E75' },
  result:        { geo: '#1D9E75', particle: '#9FE1CB', light: '#0F6E56' },
  'false-start': { geo: '#D85A30', particle: '#F0997B', light: '#D85A30' },
  summary:       { geo: '#7F77DD', particle: '#AFA9EC', light: '#534AB7' },
};
const STATE_SCENE = {
  idle:          { scale: 1.00, shell: 1.00, rotSpeed: 0.005, morph: 0.18, morphSpeed: 0.55, particleMode: 'idle',    pulse: false, shudder: false },
  waiting:       { scale: 1.05, shell: 1.05, rotSpeed: 0.002, morph: 0.10, morphSpeed: 0.35, particleMode: 'idle',    pulse: true,  shudder: false },
  react:         { scale: 1.30, shell: 1.55, rotSpeed: 0.024, morph: 0.45, morphSpeed: 1.80, particleMode: 'burst',   pulse: false, shudder: false },
  result:        { scale: 1.00, shell: 1.00, rotSpeed: 0.010, morph: 0.22, morphSpeed: 0.80, particleMode: 'settle',  pulse: false, shudder: false },
  'false-start': { scale: 0.95, shell: 0.65, rotSpeed: 0.026, morph: 0.55, morphSpeed: 2.40, particleMode: 'scatter', pulse: false, shudder: true  },
  summary:       { scale: 0.55, shell: 0.40, rotSpeed: 0.003, morph: 0.08, morphSpeed: 0.25, particleMode: 'drift',   pulse: false, shudder: false },
};
const SATELLITE_COUNT       = 5;
const RESULT_AUTO_ADVANCE   = 1400;  // ms — result → next round / summary
const FALSESTART_RETRY_WAIT = 1800;  // ms — false-start → retry same round

/* ============================================================
 * 2. THREE.JS SETUP — renderer, scene, camera, lights
 * ============================================================ */
const canvasContainer = document.getElementById('canvas-container');

const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
// Cap pixel ratio at 2 — protects mobile GPUs from rendering at 3x cost
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x0D0D0F, 1);
canvasContainer.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);
camera.position.set(0, 0, 5);

// Low ambient so the orbiting point light does most of the work — gives the
// icosahedron its directional shading and makes color shifts visible.
const ambient = new THREE.AmbientLight(0xffffff, 0.35);
scene.add(ambient);

const pointLight = new THREE.PointLight(0x7F77DD, 60, 40, 1.5);
pointLight.position.set(3, 2, 4);
scene.add(pointLight);

/* ============================================================
 * 3. GEOMETRY — layered: central knot + wireframe shell + satellites
 * ============================================================ */
// Single parent group so the whole composition can scale/translate as a unit
const shapeGroup = new THREE.Group();
scene.add(shapeGroup);

// Morphing core — a subdivided icosahedron whose vertices are displaced
// along their radial direction by a sin-fbm noise field every frame.
// The result reads as a living organic crystal that pulses with state.
const coreGeometry = new THREE.IcosahedronGeometry(0.85, 2);
const coreMaterial = new THREE.MeshStandardMaterial({
  color:       new THREE.Color(STATE_COLORS.idle.geo),
  roughness:   0.18,
  metalness:   0.7,
  flatShading: true,
});
const core = new THREE.Mesh(coreGeometry, coreMaterial);
shapeGroup.add(core);

// Snapshot the pristine positions and unit normals once; morphing always
// displaces from this rest state so noise doesn't compound across frames.
const corePositionAttr = coreGeometry.attributes.position;
const coreBaseRadius   = 0.85;
const restPositions    = new Float32Array(corePositionAttr.array);
const restNormals      = new Float32Array(restPositions.length);
for (let i = 0; i < restPositions.length; i += 3) {
  const x = restPositions[i], y = restPositions[i + 1], z = restPositions[i + 2];
  const len = Math.sqrt(x * x + y * y + z * z) || 1;
  restNormals[i]     = x / len;
  restNormals[i + 1] = y / len;
  restNormals[i + 2] = z / len;
}

// Cheap deterministic pseudo-noise: layered sines. Smooth, periodic, no
// texture lookup or imported noise lib — plenty for organic deformation.
function fbmNoise(x, y, z) {
  return (
    Math.sin(x * 1.8 + Math.cos(y * 1.4 + 0.7)) * 0.55 +
    Math.cos(y * 2.1 + Math.sin(z * 1.6 + 1.3)) * 0.30 +
    Math.sin(z * 2.7 + Math.cos(x * 1.1 + 2.1)) * 0.15
  );
}

// Wireframe icosahedron shell — frames the knot at scale ~2, counter-rotates,
// and "breathes" with state (collapses on false-start, expands on react).
const shellGeometry = new THREE.IcosahedronGeometry(1.9, 1);
const shellMaterial = new THREE.MeshBasicMaterial({
  color:       new THREE.Color(STATE_COLORS.idle.geo),
  wireframe:   true,
  transparent: true,
  opacity:     0.18,
});
const shell = new THREE.Mesh(shellGeometry, shellMaterial);
shapeGroup.add(shell);

// Orbiting octahedron satellites — each has its own orbit radius, speed,
// tilted plane, and self-spin axis so the motion never feels mechanical.
const satelliteGeometry = new THREE.OctahedronGeometry(0.13, 0);
const satellites = [];
for (let i = 0; i < SATELLITE_COUNT; i++) {
  const mat = new THREE.MeshStandardMaterial({
    color:       new THREE.Color(STATE_COLORS.idle.particle),
    roughness:   0.25,
    metalness:   0.7,
    flatShading: true,
  });
  const sat = new THREE.Mesh(satelliteGeometry, mat);
  sat.userData = {
    radius:   1.55 + Math.random() * 0.6,
    speed:    0.35 + Math.random() * 0.5,
    phase:    Math.random() * Math.PI * 2,
    tilt:     (Math.random() - 0.5) * 1.4,    // orbital-plane tilt (radians)
    spinAxis: new THREE.Vector3(
      Math.random() - 0.5,
      Math.random() - 0.5,
      Math.random() - 0.5
    ).normalize(),
    spinRate: 0.6 + Math.random() * 1.2,
  };
  satellites.push(sat);
  shapeGroup.add(sat);
}

// Convenience array of every material whose color should follow the geometry palette
const geoMaterials = [coreMaterial, shellMaterial];
const satMaterials = satellites.map(s => s.material);

/* ============================================================
 * 4. PARTICLE SYSTEM
 * ============================================================ */
const particleGeo  = new THREE.BufferGeometry();
const basePositions = new Float32Array(PARTICLE_COUNT * 3);
const positions     = new Float32Array(PARTICLE_COUNT * 3);
const velocities    = new Float32Array(PARTICLE_COUNT * 3);
const phaseOffsets  = new Float32Array(PARTICLE_COUNT);

for (let i = 0; i < PARTICLE_COUNT; i++) {
  // Uniform distribution on a spherical shell (acos trick avoids polar clustering)
  const theta = Math.random() * Math.PI * 2;
  const phi   = Math.acos(2 * Math.random() - 1);
  const r     = PARTICLE_INNER + Math.random() * (PARTICLE_OUTER - PARTICLE_INNER);
  const x = r * Math.sin(phi) * Math.cos(theta);
  const y = r * Math.sin(phi) * Math.sin(theta);
  const z = r * Math.cos(phi);
  basePositions[i * 3]     = x;
  basePositions[i * 3 + 1] = y;
  basePositions[i * 3 + 2] = z;
  positions[i * 3]     = x;
  positions[i * 3 + 1] = y;
  positions[i * 3 + 2] = z;
  phaseOffsets[i] = Math.random() * Math.PI * 2;
}

particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

const particleMaterial = new THREE.PointsMaterial({
  color:           new THREE.Color(STATE_COLORS.idle.particle),
  size:            0.045,
  transparent:     true,
  opacity:         0.85,
  sizeAttenuation: true,
  depthWrite:      false,
});
const particles = new THREE.Points(particleGeo, particleMaterial);
scene.add(particles);

/* ============================================================
 * 5. SCENE STATE — what the animate loop is reaching toward
 * ============================================================ */
const sceneTarget = {
  geoColor:      new THREE.Color(STATE_COLORS.idle.geo),
  particleColor: new THREE.Color(STATE_COLORS.idle.particle),
  lightColor:    new THREE.Color(STATE_COLORS.idle.light),
  groupScale:    STATE_SCENE.idle.scale,
  shellScale:    STATE_SCENE.idle.shell,
  rotationSpeed: STATE_SCENE.idle.rotSpeed,
  morphAmount:   STATE_SCENE.idle.morph,
  morphSpeed:    STATE_SCENE.idle.morphSpeed,
  particleMode:  STATE_SCENE.idle.particleMode,
  pulse:         STATE_SCENE.idle.pulse,
  shudder:       STATE_SCENE.idle.shudder,
  particleOpacity: 0.85,
};
let particleModeStart = performance.now();

/* ============================================================
 * 6. updateScene(state) — single entry from game logic into Three.js
 * ============================================================ */
function updateScene(state) {
  const colors = STATE_COLORS[state];
  const cfg    = STATE_SCENE[state];

  sceneTarget.geoColor.set(colors.geo);
  sceneTarget.particleColor.set(colors.particle);
  sceneTarget.lightColor.set(colors.light);
  sceneTarget.groupScale    = cfg.scale;
  sceneTarget.shellScale    = cfg.shell;
  sceneTarget.rotationSpeed = cfg.rotSpeed;
  sceneTarget.morphAmount   = cfg.morph;
  sceneTarget.morphSpeed    = cfg.morphSpeed;
  sceneTarget.pulse         = cfg.pulse;
  sceneTarget.shudder       = cfg.shudder;
  sceneTarget.particleOpacity = state === 'react' ? 1.0 : 0.75;

  // Particle mode changes are discrete — reset the mode clock and seed
  // velocities for modes that integrate them.
  if (cfg.particleMode !== sceneTarget.particleMode) {
    sceneTarget.particleMode = cfg.particleMode;
    particleModeStart = performance.now();

    if (cfg.particleMode === 'scatter') {
      // High random velocities — chaotic outward burst
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        velocities[i * 3]     = (Math.random() - 0.5) * 6;
        velocities[i * 3 + 1] = (Math.random() - 0.5) * 6;
        velocities[i * 3 + 2] = (Math.random() - 0.5) * 6;
      }
    } else if (cfg.particleMode === 'drift') {
      // Slow upward drift with slight horizontal wander
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        velocities[i * 3]     = (Math.random() - 0.5) * 0.25;
        velocities[i * 3 + 1] = 0.08 + Math.random() * 0.32;
        velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.25;
      }
    }
  }
}

/* ============================================================
 * 7. animate() — RAF loop. Reads sceneTarget, never sets game state.
 * ============================================================ */
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  const t  = clock.getElapsedTime();

  // Color interpolation — knot + shell follow geometry palette; satellites
  // and particle cloud follow the particle palette so they read as a swarm.
  for (const m of geoMaterials) m.color.lerp(sceneTarget.geoColor, LERP_FACTOR);
  for (const m of satMaterials) m.color.lerp(sceneTarget.particleColor, LERP_FACTOR);
  particleMaterial.color.lerp(sceneTarget.particleColor, LERP_FACTOR);
  pointLight.color.lerp(sceneTarget.lightColor, LERP_FACTOR);

  // Group scale (with optional waiting-state pulse for "morph/pulse" feel)
  let groupGoal = sceneTarget.groupScale;
  if (sceneTarget.pulse) groupGoal += Math.sin(t * 2.4) * 0.08;
  const gs = THREE.MathUtils.lerp(shapeGroup.scale.x, groupGoal, LERP_FACTOR);
  shapeGroup.scale.set(gs, gs, gs);

  // Wireframe shell scales independently within the group — collapses on
  // false-start, expands on react, gives layered depth otherwise.
  const ss = THREE.MathUtils.lerp(shell.scale.x, sceneTarget.shellScale, LERP_FACTOR);
  shell.scale.set(ss, ss, ss);

  // Shudder = false-start. Random jitter on the whole group, then recovers.
  if (sceneTarget.shudder) {
    shapeGroup.position.x = (Math.random() - 0.5) * 0.18;
    shapeGroup.position.y = (Math.random() - 0.5) * 0.18;
  } else {
    shapeGroup.position.x = THREE.MathUtils.lerp(shapeGroup.position.x, 0, 0.2);
    shapeGroup.position.y = THREE.MathUtils.lerp(shapeGroup.position.y, 0, 0.2);
  }

  // Core: spin on Y with a slight X drift…
  core.rotation.y += sceneTarget.rotationSpeed * 1.4;
  core.rotation.x += sceneTarget.rotationSpeed * 0.35;

  // …and morph the surface. Each vertex is pushed/pulled along its rest
  // normal by an fbm-noise field that scrolls through time at morphSpeed.
  // morphAmount controls how dramatic the deformation gets per state.
  const morph = THREE.MathUtils.lerp(
    core.userData.currentMorph ?? sceneTarget.morphAmount,
    sceneTarget.morphAmount,
    LERP_FACTOR
  );
  const mspd = THREE.MathUtils.lerp(
    core.userData.currentMorphSpeed ?? sceneTarget.morphSpeed,
    sceneTarget.morphSpeed,
    LERP_FACTOR
  );
  core.userData.currentMorph      = morph;
  core.userData.currentMorphSpeed = mspd;

  const arr = corePositionAttr.array;
  const tm  = t * mspd;
  for (let i = 0; i < arr.length; i += 3) {
    const nx = restNormals[i],     ny = restNormals[i + 1], nz = restNormals[i + 2];
    const rx = restPositions[i],   ry = restPositions[i + 1], rz = restPositions[i + 2];
    const n  = fbmNoise(rx * 1.6 + tm, ry * 1.6 + tm * 0.8, rz * 1.6 + tm * 1.2);
    const displ = coreBaseRadius * morph * n;
    arr[i]     = rx + nx * displ;
    arr[i + 1] = ry + ny * displ;
    arr[i + 2] = rz + nz * displ;
  }
  corePositionAttr.needsUpdate = true;
  coreGeometry.computeVertexNormals();

  // Shell counter-rotates — opposite direction, slower — creates depth parallax
  shell.rotation.y -= sceneTarget.rotationSpeed * 0.6;
  shell.rotation.x -= sceneTarget.rotationSpeed * 0.3;

  // Satellites: orbit around the origin on tilted planes, plus self-spin.
  // Speed scales with the global rotation speed so they accelerate on react.
  const speedScale = 1 + sceneTarget.rotationSpeed * 30; // 1.0 → ~1.8 across states
  for (const sat of satellites) {
    const d = sat.userData;
    const angle = t * d.speed * speedScale + d.phase;
    // Circle in XZ plane, then rotate that plane around the X axis by `tilt`
    const cx = Math.cos(angle) * d.radius;
    const cz = Math.sin(angle) * d.radius;
    sat.position.set(
      cx,
      -cz * Math.sin(d.tilt),
       cz * Math.cos(d.tilt)
    );
    sat.rotateOnAxis(d.spinAxis, d.spinRate * dt);
  }

  // Point light orbits on a slow elliptical path
  pointLight.position.x = Math.cos(t * 0.45) * 4.2;
  pointLight.position.z = Math.sin(t * 0.45) * 4.2;
  pointLight.position.y = Math.sin(t * 0.3) * 2.2;

  updateParticles(dt);

  // Lerp particle opacity toward its state target
  particleMaterial.opacity = THREE.MathUtils.lerp(
    particleMaterial.opacity, sceneTarget.particleOpacity, LERP_FACTOR
  );

  renderer.render(scene, camera);
}

function updateParticles(dt) {
  const mode    = sceneTarget.particleMode;
  const elapsed = (performance.now() - particleModeStart) / 1000;

  if (mode === 'idle') {
    // Gentle oscillation around base position. Lerping (not snapping)
    // means we recover smoothly when coming back from any prior mode.
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const o = phaseOffsets[i];
      const tx = basePositions[i * 3]     + Math.sin(elapsed * 0.6 + o) * 0.10;
      const ty = basePositions[i * 3 + 1] + Math.cos(elapsed * 0.5 + o) * 0.10;
      const tz = basePositions[i * 3 + 2] + Math.sin(elapsed * 0.4 + o) * 0.10;
      positions[i * 3]     = THREE.MathUtils.lerp(positions[i * 3],     tx, PARTICLE_LERP);
      positions[i * 3 + 1] = THREE.MathUtils.lerp(positions[i * 3 + 1], ty, PARTICLE_LERP);
      positions[i * 3 + 2] = THREE.MathUtils.lerp(positions[i * 3 + 2], tz, PARTICLE_LERP);
    }
  } else if (mode === 'burst') {
    // Each particle flies straight out along its base-vector. Linear
    // progress over BURST_DURATION gives a clean, readable expansion.
    const p = Math.min(elapsed * 1000 / BURST_DURATION, 1);
    const factor = 1 + (BURST_SPEED - 1) * p;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      positions[i * 3]     = basePositions[i * 3]     * factor;
      positions[i * 3 + 1] = basePositions[i * 3 + 1] * factor;
      positions[i * 3 + 2] = basePositions[i * 3 + 2] * factor;
    }
  } else if (mode === 'settle') {
    // Lerp current → base. Works regardless of where particles were left.
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      positions[i * 3]     = THREE.MathUtils.lerp(positions[i * 3],     basePositions[i * 3],     0.05);
      positions[i * 3 + 1] = THREE.MathUtils.lerp(positions[i * 3 + 1], basePositions[i * 3 + 1], 0.05);
      positions[i * 3 + 2] = THREE.MathUtils.lerp(positions[i * 3 + 2], basePositions[i * 3 + 2], 0.05);
    }
  } else if (mode === 'scatter') {
    // Integrate seeded velocities with mild damping
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      positions[i * 3]     += velocities[i * 3]     * dt;
      positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
      positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;
      velocities[i * 3]     *= 0.97;
      velocities[i * 3 + 1] *= 0.97;
      velocities[i * 3 + 2] *= 0.97;
    }
  } else if (mode === 'drift') {
    // Rising-mist effect: gentle upward velocity with horizontal wander.
    // When a particle rises above the visible cap, respawn it at the
    // bottom of the volume on a random radius so the cloud never empties.
    const RESET_Y   = 3.6;
    const RESPAWN_Y = -3.2;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      positions[i * 3]     += velocities[i * 3]     * dt;
      positions[i * 3 + 1] += velocities[i * 3 + 1] * dt;
      positions[i * 3 + 2] += velocities[i * 3 + 2] * dt;
      if (positions[i * 3 + 1] > RESET_Y) {
        const theta = Math.random() * Math.PI * 2;
        const r     = PARTICLE_INNER + Math.random() * (PARTICLE_OUTER - PARTICLE_INNER);
        positions[i * 3]     = Math.cos(theta) * r;
        positions[i * 3 + 1] = RESPAWN_Y + Math.random() * 0.6;
        positions[i * 3 + 2] = Math.sin(theta) * r;
      }
    }
  }

  particleGeo.attributes.position.needsUpdate = true;
}

/* Resize handler — keep renderer + camera in sync with viewport */
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ============================================================
 * 8. GAME STATE
 * ============================================================ */
const gameState = {
  state:                'idle',
  round:                0,    // 1..TOTAL_ROUNDS while playing
  results:              [],   // ms per completed round
  lastResult:           null,
  waitingTimeoutId:     null,
  reactStartTime:       null,
  autoAdvanceTimeoutId: null, // timer that auto-leaves result / false-start
};

/* ============================================================
 * 9. STATE MACHINE
 * ============================================================ */
function setState(newState) {
  // Cancel any pending auto-advance — the new state owns the future now
  if (gameState.autoAdvanceTimeoutId !== null) {
    clearTimeout(gameState.autoAdvanceTimeoutId);
    gameState.autoAdvanceTimeoutId = null;
  }

  gameState.state = newState;
  updateScene(newState);
  render();

  // Auto-advance terminal-feedback states so the player isn't forced to click
  if (newState === 'result') {
    gameState.autoAdvanceTimeoutId = setTimeout(() => {
      gameState.autoAdvanceTimeoutId = null;
      nextRound();
    }, RESULT_AUTO_ADVANCE);
  } else if (newState === 'false-start') {
    gameState.autoAdvanceTimeoutId = setTimeout(() => {
      gameState.autoAdvanceTimeoutId = null;
      startWaiting();
    }, FALSESTART_RETRY_WAIT);
  }
}

/* ============================================================
 * 10. TIMING FUNCTIONS
 * ============================================================ */
function startSession() {
  gameState.results    = [];
  gameState.round      = 1;
  gameState.lastResult = null;
  startWaiting();
}

function startWaiting() {
  setState('waiting');
  const delay = MIN_DELAY + Math.random() * (MAX_DELAY - MIN_DELAY);
  gameState.waitingTimeoutId = setTimeout(triggerReact, delay);
}

function triggerReact() {
  gameState.waitingTimeoutId = null;
  gameState.reactStartTime = performance.now();
  setState('react');
}

function recordResult() {
  const elapsed = Math.round(performance.now() - gameState.reactStartTime);
  gameState.lastResult = elapsed;
  gameState.results.push(elapsed);
  setState('result');
}

function handleFalseStart() {
  if (gameState.waitingTimeoutId !== null) {
    clearTimeout(gameState.waitingTimeoutId);
    gameState.waitingTimeoutId = null;
  }
  gameState.lastResult = null;
  setState('false-start');
}

function nextRound() {
  if (gameState.round >= TOTAL_ROUNDS) {
    setState('summary');
  } else {
    gameState.round += 1;
    startWaiting();
  }
}

/* ============================================================
 * 11. UI RENDERING — DOM only, reads gameState
 * ============================================================ */
const panel        = document.getElementById('game-panel');
const panelContent = document.getElementById('panel-content');

function ratingLabel(ms) {
  if (ms < RATING_THRESHOLDS.lightning) return 'Lightning';
  if (ms < RATING_THRESHOLDS.sharp)     return 'Sharp';
  if (ms < RATING_THRESHOLDS.average)   return 'Average';
  return 'Sluggish';
}
function ratingClass(ms) {
  if (ms < RATING_THRESHOLDS.lightning) return 'r-lightning';
  if (ms < RATING_THRESHOLDS.sharp)     return 'r-sharp';
  if (ms < RATING_THRESHOLDS.average)   return 'r-average';
  return 'r-sluggish';
}

function consistencyLabel(spread) {
  if (spread < 60)  return 'razor-tight';
  if (spread < 120) return 'tight';
  if (spread < 200) return 'steady';
  if (spread < 300) return 'variable';
  return 'scattered';
}

// Returns the verdict block for the summary — a rating title, an
// explanation paragraph, and a one-line stats detail.
function evaluationFor(avg, best, worst) {
  const spread = worst - best;
  let title, text;
  if (avg < RATING_THRESHOLDS.lightning) {
    title = 'Lightning fast';
    text  = `Reaction times under ${RATING_THRESHOLDS.lightning}ms are exceptional — you're operating near the limits of human visual processing. This is competitive-esports territory and well below the ~250ms adult average.`;
  } else if (avg < RATING_THRESHOLDS.sharp) {
    title = 'Sharp instincts';
    text  = `Comfortably faster than the ~250ms adult average. You're alert, focused, and quick to respond to visual cues — the range trained gamers and athletes tend to land in.`;
  } else if (avg < RATING_THRESHOLDS.average) {
    title = 'Right on pace';
    text  = `Your reactions sit within the typical human range. Most adults score 280–350ms on visual reaction tasks like this one — perfectly normal, with room to sharpen.`;
  } else {
    title = 'Take it slow';
    text  = `Your times are above the typical range. Fatigue, distraction, or hesitating instead of reacting can all push latency up — try again when fully focused for a cleaner read.`;
  }
  const detail = `Spread ${spread}ms · ${consistencyLabel(spread)} consistency · human visual baseline ~250ms`;
  return { title, text, detail };
}

function render() {
  const s = gameState.state;
  panel.dataset.state = s;

  if (s === 'idle') {
    panelContent.innerHTML = `
      <p class="eyebrow">Reaction Timer</p>
      <h1 class="title">React. <span class="title-accent">How fast are you?</span></h1>
      <p class="subtitle">${TOTAL_ROUNDS} rounds. Once started, click anywhere — or press <strong>Space</strong> — the moment you see <strong>GO</strong>.</p>
      <div><button class="btn" type="button">Start</button></div>
    `;
  } else if (s === 'waiting') {
    panelContent.innerHTML = `
      <p class="round-indicator">ROUND ${gameState.round} / ${TOTAL_ROUNDS}</p>
      <h1 class="title">Get ready<span class="dots"></span></h1>
      <p class="subtitle">Wait for GO — don't click yet.</p>
    `;
  } else if (s === 'react') {
    panelContent.innerHTML = `
      <h1 class="title go">GO!</h1>
    `;
  } else if (s === 'result') {
    const ms     = gameState.lastResult;
    const isLast = gameState.round >= TOTAL_ROUNDS;
    panelContent.innerHTML = `
      <p class="round-indicator">ROUND ${gameState.round} / ${TOTAL_ROUNDS}</p>
      <p class="result-time"><span class="ms">${ms}</span><span class="unit">ms</span></p>
      <p class="rating ${ratingClass(ms)}">${ratingLabel(ms)}</p>
      <p class="caption">${isLast ? 'Summary in a moment…' : 'Next round in a moment…'}</p>
      <div class="progress-track"><div class="progress-fill" style="animation-duration:${RESULT_AUTO_ADVANCE}ms"></div></div>
    `;
  } else if (s === 'false-start') {
    panelContent.innerHTML = `
      <p class="round-indicator">ROUND ${gameState.round} / ${TOTAL_ROUNDS}</p>
      <h1 class="title coral">Too early!</h1>
      <p class="subtitle">Wait for GO before clicking. Retrying this round…</p>
      <div class="progress-track"><div class="progress-fill coral" style="animation-duration:${FALSESTART_RETRY_WAIT}ms"></div></div>
    `;
  } else if (s === 'summary') {
    const results = gameState.results;
    const avg     = Math.round(results.reduce((a, b) => a + b, 0) / results.length);
    const best    = Math.min(...results);
    const worst   = Math.max(...results);
    const ev      = evaluationFor(avg, best, worst);
    const evClass = ratingClass(avg);
    panelContent.innerHTML = `
      <p class="eyebrow">Session complete</p>
      <div class="stats-grid">
        <div class="stat ${ratingClass(best)}">
          <div class="stat-label">Best</div>
          <div class="stat-value ${ratingClass(best)}">${best}<span>ms</span></div>
        </div>
        <div class="stat ${ratingClass(avg)}">
          <div class="stat-label">Average</div>
          <div class="stat-value ${ratingClass(avg)}">${avg}<span>ms</span></div>
        </div>
        <div class="stat ${ratingClass(worst)}">
          <div class="stat-label">Worst</div>
          <div class="stat-value ${ratingClass(worst)}">${worst}<span>ms</span></div>
        </div>
      </div>
      <div class="evaluation ${evClass}">
        <h3 class="eval-title ${evClass}">${ev.title}</h3>
        <p class="eval-text">${ev.text}</p>
        <p class="eval-detail">${ev.detail}</p>
      </div>
      <ol class="history">
        ${results.map((r, i) => `
          <li class="${ratingClass(r)}">
            <span class="round-name">Round ${i + 1}</span>
            <span class="time-value">${r}<small>ms</small></span>
            <span class="rating-tag">${ratingLabel(r)}</span>
          </li>
        `).join('')}
      </ol>
      <div><button class="btn" type="button">Play again</button></div>
    `;
  }
}

/* ============================================================
 * 12. EVENT LISTENERS — entire viewport is a single click zone
 * ============================================================ */
function handleAction() {
  switch (gameState.state) {
    case 'waiting':
      handleFalseStart();
      break;
    case 'react':
      recordResult();
      break;
    case 'result':
      nextRound();
      break;
    case 'false-start':
      // Retry current round — round number stays the same
      startWaiting();
      break;
    // idle & summary intentionally fall through — only the explicit
    // Start / Play again button is allowed to begin a session.
  }
}

// pointerdown beats click by ~50–100ms and works for touch + mouse
// uniformly — critical for honest reaction timing during play.
document.addEventListener('pointerdown', handleAction);

document.addEventListener('keydown', (e) => {
  if ((e.code === 'Space' || e.key === ' ') && !e.repeat) {
    // Don't hijack space on idle/summary — let the focused button
    // handle it natively (keyboard accessibility for the Start button).
    if (gameState.state === 'idle' || gameState.state === 'summary') return;
    e.preventDefault();
    handleAction();
  }
});

// Delegated click handler: only the button inside the panel can start
// a session. This is intentionally separate from the document-level
// pointerdown handler so empty clicks on the canvas never start a game.
panel.addEventListener('click', (e) => {
  const target = e.target;
  const btn = target instanceof Element ? target.closest('button.btn') : null;
  if (!btn) return;
  if (gameState.state === 'idle' || gameState.state === 'summary') {
    startSession();
  }
});

// Stop spacebar from also "clicking" a focused button (would double-fire)
document.addEventListener('keyup', (e) => {
  if (e.code === 'Space' && document.activeElement instanceof HTMLButtonElement) {
    document.activeElement.blur();
  }
});

/* ============================================================
 * 13. INIT
 * ============================================================ */
function init() {
  setState('idle');
  animate();
}
init();
