(function () {
  'use strict';

  const canvas = document.getElementById('timing-canvas');
  if (!canvas || typeof THREE === 'undefined') return;

  // ── Renderer ──
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  function parentSize() {
    const p = canvas.parentElement;
    const w = Math.max(300, p.clientWidth);
    const h = Math.round(Math.max(380, Math.min(540, w * 0.72)));
    return { w, h };
  }

  let sz = parentSize();
  renderer.setSize(sz.w, sz.h);

  // ── Scene ──
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a1a);
  scene.fog = new THREE.Fog(0x1a1a1a, 14, 22);

  // ── Camera ──
  const DEFAULT_POS    = new THREE.Vector3(2.8, 1.8, 4.5);
  const DEFAULT_TARGET = new THREE.Vector3(0, 0.15, 0);
  const camera = new THREE.PerspectiveCamera(45, sz.w / sz.h, 0.1, 100);
  camera.position.copy(DEFAULT_POS);
  camera.lookAt(DEFAULT_TARGET);

  // ── Orbit Controls ──
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor  = 0.08;
  controls.target.copy(DEFAULT_TARGET);
  controls.minPolarAngle  = 0.05;
  controls.maxPolarAngle  = Math.PI * 0.82;
  controls.minDistance    = 2;
  controls.maxDistance    = 12;
  controls.update();

  // ── Lights ──
  scene.add(new THREE.AmbientLight(0xffffff, 0.42));

  const sun = new THREE.DirectionalLight(0xffffff, 0.92);
  sun.position.set(3, 5, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left   = -5;
  sun.shadow.camera.right  =  5;
  sun.shadow.camera.top    =  5;
  sun.shadow.camera.bottom = -5;
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0x7799bb, 0.24);
  fill.position.set(-3, 1, -2);
  scene.add(fill);

  // ── Materials ──
  const matWall   = new THREE.MeshStandardMaterial({ color: 0x484848, metalness: 0.65, roughness: 0.45 });
  const matPiston = new THREE.MeshStandardMaterial({ color: 0xb87333, metalness: 0.72, roughness: 0.28 });
  const matRing   = new THREE.MeshStandardMaterial({ color: 0x1c1c1c, metalness: 0.88, roughness: 0.18 });
  const matRod    = new THREE.MeshStandardMaterial({ color: 0xbbbbbb, metalness: 0.88, roughness: 0.16 });

  // ── Helper ──
  function mkBox(w, h, d, mat, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow    = true;
    m.receiveShadow = true;
    return m;
  }

  // ── Geometry Constants ──
  const IW  = 1.00;            // cylinder inner width  (X)
  const ID  = 1.00;            // cylinder inner depth  (Z)
  const WT  = 0.13;            // wall thickness
  const CT  = 1.20;            // cylinder top    Y  (cylinder head face)
  const CB  = -0.65;           // cylinder bottom Y  (open to crankcase)
  const CH  = CT - CB;         // cylinder height
  const CMY = (CT + CB) / 2;  // cylinder mid-Y

  const PW = IW - 0.04;   // piston width
  const PH = 0.44;         // piston height
  const PD = ID - 0.04;   // piston depth

  const CCY = -1.55;  // crankshaft centre Y
  const CR  =  0.60;  // crank throw (radius)
  const RL  =  1.60;  // connecting rod length

  // ── Cylinder Block (5-sided — open front) ──
  const cylGroup = new THREE.Group();
  cylGroup.add(mkBox(WT, CH, ID + WT*2, matWall, -(IW/2 + WT/2), CMY, 0));          // left
  cylGroup.add(mkBox(WT, CH, ID + WT*2, matWall,  (IW/2 + WT/2), CMY, 0));          // right
  cylGroup.add(mkBox(IW + WT*2, CH, WT, matWall, 0, CMY, -(ID/2 + WT/2)));           // back
  cylGroup.add(mkBox(IW + WT*2, WT, ID + WT*2, matWall, 0, CT + WT/2, 0));           // top / head
  scene.add(cylGroup);

  // ── Piston ──
  const pistonGroup = new THREE.Group();

  const pistonBody = new THREE.Mesh(new THREE.BoxGeometry(PW, PH, PD), matPiston);
  pistonBody.castShadow = pistonBody.receiveShadow = true;
  pistonGroup.add(pistonBody);

  // Two piston rings as rectangular loops
  function addRing(parent, relY) {
    const t = 0.046, rh = 0.050;
    const hw = PW / 2, hd = PD / 2;
    [
      [PW + t*2, rh, t,   0,        relY,  hd + t/2],  // front
      [PW + t*2, rh, t,   0,        relY, -hd - t/2],  // back
      [t, rh, PD,  -hw - t/2,  relY,  0         ],     // left
      [t, rh, PD,   hw + t/2,  relY,  0         ],     // right
    ].forEach(([w, h, d, x, y, z]) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), matRing);
      m.position.set(x, y, z);
      parent.add(m);
    });
  }

  addRing(pistonGroup, PH *  0.30);  // upper ring
  addRing(pistonGroup, PH *  0.06);  // lower ring
  scene.add(pistonGroup);

  // ── Connecting Rod ──
  const rod = new THREE.Mesh(new THREE.BoxGeometry(0.10, RL, 0.07), matRod);
  rod.castShadow = true;
  scene.add(rod);

  // ── Animation State ──
  let crankAngle = 0;
  let animSpeed  = 1.0;
  let paused     = false;
  const clock    = new THREE.Clock();

  // ── UI Wiring ──
  const btnPause = document.getElementById('timing-pause');
  const sldSpeed = document.getElementById('timing-speed');
  const outSpeed = document.getElementById('timing-speed-out');
  const btnReset = document.getElementById('timing-reset');

  if (btnPause) btnPause.addEventListener('click', () => {
    paused = !paused;
    btnPause.textContent = paused ? 'המשך' : 'עצור';
  });
  if (sldSpeed) sldSpeed.addEventListener('input', () => {
    animSpeed = parseFloat(sldSpeed.value);
    if (outSpeed) outSpeed.textContent = animSpeed.toFixed(1) + '×';
  });
  if (btnReset) btnReset.addEventListener('click', () => {
    camera.position.copy(DEFAULT_POS);
    controls.target.copy(DEFAULT_TARGET);
    controls.update();
  });

  // ── Resize ──
  window.addEventListener('resize', () => {
    const { w, h } = parentSize();
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });

  // ── Render Loop ──
  function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    if (!paused) crankAngle += delta * animSpeed * 2.2;

    // Crankpin world position
    // θ=0 → crankpin above crank centre → piston at TDC
    const cpX = CR * Math.sin(crankAngle);
    const cpY = CCY + CR * Math.cos(crankAngle);

    // Piston pin Y (constrained to x=0 axis)
    const pistonPinY = cpY + Math.sqrt(Math.max(0, RL * RL - cpX * cpX));

    // Piston: centre = pin + half-height
    pistonGroup.position.y = pistonPinY + PH / 2;

    // Connecting rod: positioned between crankpin and piston pin
    rod.position.set(cpX / 2, (pistonPinY + cpY) / 2, 0);
    // Rotate so rod Y-axis aligns from crankpin → piston pin
    rod.rotation.z = Math.atan2(cpX, pistonPinY - cpY);

    controls.update();
    renderer.render(scene, camera);
  }

  animate();
})();
