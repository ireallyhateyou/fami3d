let nes, nesDisplay, nesAudio;
let nesCanvas = document.getElementById('nes-canvas');
let threejsCanvas = document.getElementById('threejs-canvas');
let is3D = false;

// 3D setup
let renderer, scene, camera, backgroundGroup;

function setup3D() {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ canvas: threejsCanvas, antialias: false });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x111111);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, -50, 400);
  camera.lookAt(0, 0, 0);
  backgroundGroup = new THREE.Group();
  scene.add(backgroundGroup);
  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
}

function render3D() {
  if (!renderer) setup3D();
  renderer.render(scene, camera);
}

function clearGroup(group) {
  while (group.children.length > 0) {
    const obj = group.children[0];
    group.remove(obj);
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) obj.material.dispose();
  }
}

// --- ROM Loading and NES-JS Setup ---

document.getElementById('romfile').addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(event) {
    window.romBuffer = event.target.result;
    document.getElementById('startBtn').disabled = false;
  };
  reader.readAsArrayBuffer(file);
});

document.getElementById('startBtn').addEventListener('click', function() {
  if (!window.romBuffer) {
    alert('No ROM loaded');
    return;
  }
  // NES-JS setup
  nes = new NesJs.Nes();
  nes.setRom(new NesJs.Rom(window.romBuffer));
  nesDisplay = new NesJs.Display(nesCanvas);
  nes.setDisplay(nesDisplay);
  nesAudio = new NesJs.Audio();
  nes.setAudio(nesAudio);

  window.onkeydown = function(e) { nes.handleKeyDown(e); };
  window.onkeyup = function(e) { nes.handleKeyUp(e); };

  nes.bootup();
  nes.run();

  // Expose for debugging
  window.nes = nes;
  window.nesDisplay = nesDisplay;
  window.nesAudio = nesAudio;

  // Start animation loop
  requestAnimationFrame(mainLoop);
});

// --- 2D/3D Toggle ---

document.getElementById('toggle3dBtn').addEventListener('click', function() {
  is3D = !is3D;
  if (is3D) {
    nesCanvas.style.display = 'none';
    threejsCanvas.style.display = 'block';
    threejsCanvas.style.width = '100vw';
    threejsCanvas.style.height = '100vh';
    this.textContent = 'Switch to 2D';
    setup3D();
    update3DScene();
    render3D();
  } else {
    nesCanvas.style.display = 'block';
    threejsCanvas.style.display = 'none';
    this.textContent = 'Switch to 3D';
  }
});

// --- Debug Panel ---
function createDebugPanel() {
  let panel = document.getElementById('debug-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'debug-panel';
    panel.style.position = 'fixed';
    panel.style.top = '10px';
    panel.style.right = '10px';
    panel.style.background = 'rgba(0,0,0,0.85)';
    panel.style.color = '#fff';
    panel.style.fontFamily = 'monospace';
    panel.style.fontSize = '12px';
    panel.style.padding = '10px';
    panel.style.zIndex = 1000;
    panel.style.maxWidth = '600px';
    panel.style.maxHeight = '90vh';
    panel.style.overflow = 'auto';
    document.body.appendChild(panel);
  }
  return panel;
}

function hexDump(arr, len = 32) {
  if (!arr) return '[undefined]';
  let out = '';
  for (let i = 0; i < Math.min(arr.length, len); i++) {
    out += arr[i].toString(16).padStart(2, '0') + ' ';
    if ((i+1) % 16 === 0) out += '\n';
  }
  return out.trim();
}

function propList(obj) {
  if (!obj) return '[undefined]';
  let out = '';
  for (let k of Object.keys(obj)) {
    let v = obj[k];
    let type = Array.isArray(v) ? 'array' : (v && v.constructor && v.constructor.name) || typeof v;
    out += `${k}: ${type}`;
    if (v && (v.length !== undefined) && typeof v.length === 'number') out += ` (length=${v.length})`;
    out += '\n';
  }
  return out;
}

function updateDebugPanel(ppu, oam) {
  const panel = createDebugPanel();
  // Add a button to dump everything to the console
  if (!document.getElementById('dump-btn')) {
    const btn = document.createElement('button');
    btn.id = 'dump-btn';
    btn.textContent = 'Dump nes/ppu to console';
    btn.style.marginBottom = '8px';
    btn.onclick = function() {
      console.log('--- window.nes ---');
      console.log(window.nes);
      if (window.nes) {
        for (let k of Object.keys(window.nes)) {
          try { console.log('nes.'+k, window.nes[k]); } catch(e) {}
        }
      }
      if (window.nes && window.nes.ppu) {
        console.log('--- window.nes.ppu ---');
        console.log(window.nes.ppu);
        for (let k of Object.keys(window.nes.ppu)) {
          try { console.log('nes.ppu.'+k, window.nes.ppu[k]); } catch(e) {}
        }
      }
    };
    panel.appendChild(btn);
  }
  panel.innerHTML += `
    <b>PPU Debug</b><br>
    <b>nametable</b> (ppu.vramMem 0x2000-0x23C0):<br><pre>${hexDump(ppu && ppu.vramMem ? ppu.vramMem.subarray(0x2000, 0x23C0) : undefined)}</pre>
    <b>attrTable</b> (ppu.vramMem 0x23C0-0x2400):<br><pre>${hexDump(ppu && ppu.vramMem ? ppu.vramMem.subarray(0x23C0, 0x2400) : undefined)}</pre>
    <b>patternTable</b> (ppu.chrMem):<br><pre>${hexDump(ppu && ppu.chrMem ? ppu.chrMem : undefined)}</pre>
    <b>paletteRAM</b> (ppu.paletteTable / paletteRam / paletteRAM):<br><pre>${hexDump(ppu && (ppu.paletteTable || ppu.paletteRam || ppu.paletteRAM))}</pre>
    <b>OAM</b> (ppu.oamMem / spriteMem / spriteRam):<br><pre>${hexDump(oam)}</pre>
    <hr>
    <b>window.nes properties:</b><br><pre>${propList(window.nes)}</pre>
    <b>window.nes.ppu properties:</b><br><pre>${propList(window.nes && window.nes.ppu)}</pre>
  `;
}

// --- 3D Scene from PPU Memory ---
function update3DScene() {
  if (!nes || !nes.ppu) return;
  if (!renderer) setup3D();
  if (backgroundGroup) clearGroup(backgroundGroup);

  const ppu = nes.ppu;

  // --- Debug output ---
  if (window.DEBUG_NESJS) {
    console.log('PPU:', ppu);
  }
  updateDebugPanel(ppu, undefined);

  // --- 3D Sprite Layer Visualization ---
  // Use ppu.spritePixels, ppu.spriteIds, ppu.spritePriorities (all length 256)
  // We'll render a single scanline as a 3D row of voxels
  const spritePixels = ppu.spritePixels;
  const spriteIds = ppu.spriteIds;
  const spritePriorities = ppu.spritePriorities;

  if (spritePixels && spriteIds && spritePriorities && spritePixels.length === 256) {
    const spriteGroup = new THREE.Group();
    for (let x = 0; x < 256; x++) {
      const pixel = spritePixels[x];
      const id = spriteIds[x];
      const priority = spritePriorities[x];
      // Only render non-transparent sprite pixels
      if (pixel === 0) continue;
      // Color by sprite ID (just for visualization)
      const color = new THREE.Color(`hsl(${(id / 64) * 360}, 100%, 60%)`);
      const geometry = new THREE.BoxGeometry(1, 8, 1); // 1x8x1 voxel (tall bar for visibility)
      const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
      const mesh = new THREE.Mesh(geometry, material);
      // Place at (x, y=0, z=priority*8)
      mesh.position.set(x - 128, 0, priority ? 8 : 0);
      spriteGroup.add(mesh);
    }
    backgroundGroup.add(spriteGroup);
  }
}

// --- Animation Loop ---
function mainLoop() {
  if (is3D) {
    update3DScene();
    render3D();
  }
  requestAnimationFrame(mainLoop);
}

// --- Resize Handler ---
window.addEventListener('resize', function() {
  if (!renderer || !camera) return;
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});