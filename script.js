console.log('script.js loaded');

window.addEventListener('DOMContentLoaded', () => {
  console.log('DOMContentLoaded fired');

// fami3d main script (simple canvas version)
// NES layer canvases are in the DOM

// --- Get canvas contexts ---
const bgCanvas = document.getElementById('bgCanvas');
const bgCtx = bgCanvas.getContext('2d');

const spriteCanvas = document.getElementById('spriteCanvas');
const spriteCtx = spriteCanvas.getContext('2d');

const spriteBehindCanvas = document.getElementById('spriteBehindCanvas');
const spriteBehindCtx = spriteBehindCanvas.getContext('2d');

const nesCanvas = document.createElement('canvas');
nesCanvas.width = 256; nesCanvas.height = 240;
const ctx = nesCanvas.getContext('2d');
const imageData = ctx.getImageData(0, 0, 256, 240);

let nes = null;
let animationId = null;
let romData = null;

// 3D variables
let scene, camera, renderer;
let is3DActive = false;
let nesPlanes = { bg: null, sprites: null, behind: null };

// Voxel sprite system variables
let spriteVoxels = [];
let voxelGeometry = null;
let voxelMaterial = null;
let useVoxelSprites = false; // Toggle between textured planes and voxels
// Voxel background system variables
let bgVoxels = [];
let useVoxelBg = false; // Toggle for voxelized background
let voxelBgMode = 'tile'; // 'tile', 'pixel', 'edge', or 'palette'

// Three.js initialization function
function init3D() {
  const container = document.getElementById('threejs-container');
  if (!container) {
    console.error('Three.js container not found');
    return;
  }
  
  // Make container visible
  container.style.display = 'block';
  
  // Scene setup
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a0a);
  
  // Camera setup - clear angle, far enough
  camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 1000);
  camera.position.set(0, 10, 30);
  camera.lookAt(0, 0, 0);
  
  // Renderer setup
  renderer = new THREE.WebGLRenderer({ 
    antialias: true,
    alpha: false,
    powerPreference: "high-performance"
  });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  
  // Enhanced lighting setup
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.7); // Brighter ambient
  scene.add(ambientLight);
  const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2); // Stronger directional
  directionalLight.position.set(40, 60, 100);
  directionalLight.castShadow = true;
  scene.add(directionalLight);
  
  // Create textured planes for each layer
  createNESPlanes();
  
  // Mouse controls
  setupMouseControls(container);
  
  // --- Ensure voxel system is initialized ---
  initVoxelSystem();
  is3DActive = true;
  animate3D();
  
  console.log('3D initialized - smooth textured planes');
}

// Create smooth textured planes
function createNESPlanes() {
  const planeGeometry = new THREE.PlaneGeometry(16, 12); // 256/16 = 16, 240/20 = 12
  
  // Background plane
  const bgTexture = new THREE.CanvasTexture(bgCanvas);
  bgTexture.minFilter = THREE.LinearFilter;
  bgTexture.magFilter = THREE.LinearFilter;
  const bgMaterial = new THREE.MeshLambertMaterial({ 
    map: bgTexture,
    transparent: true,
    side: THREE.DoubleSide
  });
  nesPlanes.bg = new THREE.Mesh(planeGeometry, bgMaterial);
  nesPlanes.bg.position.z = 0;
  scene.add(nesPlanes.bg);
  
  // Sprite behind plane
  const spriteBehindTexture = new THREE.CanvasTexture(spriteBehindCanvas);
  spriteBehindTexture.minFilter = THREE.LinearFilter;
  spriteBehindTexture.magFilter = THREE.LinearFilter;
  const spriteBehindMaterial = new THREE.MeshLambertMaterial({ 
    map: spriteBehindTexture,
    transparent: true,
    side: THREE.DoubleSide
  });
  nesPlanes.behind = new THREE.Mesh(planeGeometry, spriteBehindMaterial);
  nesPlanes.behind.position.z = -1.0; // Much further back
  scene.add(nesPlanes.behind);
  
  // Sprite plane
  const spriteTexture = new THREE.CanvasTexture(spriteCanvas);
  spriteTexture.minFilter = THREE.LinearFilter;
  spriteTexture.magFilter = THREE.LinearFilter;
  const spriteMaterial = new THREE.MeshLambertMaterial({ 
    map: spriteTexture,
    transparent: true,
    side: THREE.DoubleSide
  });
  nesPlanes.sprites = new THREE.Mesh(planeGeometry, spriteMaterial);
  nesPlanes.sprites.position.z = 1.0; // Much further forward
  scene.add(nesPlanes.sprites);
}

// Update 3D scene with smooth textures
function update3DScene() {
  if (!is3DActive || !scene) return;
  
  // Update textures
  if (nesPlanes.bg) {
    nesPlanes.bg.material.map.needsUpdate = true;
  }
  if (nesPlanes.behind) {
    nesPlanes.behind.material.map.needsUpdate = true;
  }
  if (nesPlanes.sprites) {
    nesPlanes.sprites.material.map.needsUpdate = true;
  }
  // Voxel background logic
  if (useVoxelBg) {
    createBgVoxels();
    if (nesPlanes.bg) nesPlanes.bg.visible = false; // Hide flat background plane
  } else {
    clearBgVoxels();
    if (nesPlanes.bg) nesPlanes.bg.visible = true;
  }
  // Voxel sprite logic
  if (useVoxelSprites) {
    createSpriteVoxels();
    if (nesPlanes.sprites) nesPlanes.sprites.visible = false;
    if (nesPlanes.behind) nesPlanes.behind.visible = false;
  } else {
    clearSpriteVoxels();
    if (nesPlanes.sprites) {
      nesPlanes.sprites.visible = true;
      nesPlanes.sprites.material.map.needsUpdate = true;
    }
    if (nesPlanes.behind) {
      nesPlanes.behind.visible = true;
      nesPlanes.behind.material.map.needsUpdate = true;
    }
  }
}

// Enhanced mouse controls
function setupMouseControls(container) {
  let mouseDown = false;
  let mouseX = 0, mouseY = 0;
  let cameraDistance = 25;
  
  container.addEventListener('mousedown', (e) => {
    mouseDown = true;
    mouseX = e.clientX;
    mouseY = e.clientY;
    container.style.cursor = 'grabbing';
  });
  
  container.addEventListener('mousemove', (e) => {
    if (!mouseDown) return;
    
    const deltaX = e.clientX - mouseX;
    const deltaY = e.clientY - mouseY;
    
    // Orbit camera around center point
    const center = new THREE.Vector3(0, 0, 0);
    const spherical = new THREE.Spherical();
    spherical.setFromVector3(camera.position.clone().sub(center));
    
    spherical.theta -= deltaX * 0.005;
    spherical.phi += deltaY * 0.005;
    spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi));
    
    camera.position.setFromSpherical(spherical).add(center);
    camera.lookAt(center);
    
    mouseX = e.clientX;
    mouseY = e.clientY;
  });
  
  container.addEventListener('mouseup', () => {
    mouseDown = false;
    container.style.cursor = 'grab';
  });
  
  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    const direction = e.deltaY > 0 ? 1.1 : 0.9;
    cameraDistance *= direction;
    cameraDistance = Math.max(10, Math.min(100, cameraDistance));
    
    const center = new THREE.Vector3(0, 0, 0);
    const direction_vec = camera.position.clone().sub(center).normalize();
    camera.position = center.clone().add(direction_vec.multiplyScalar(cameraDistance));
  });
  
  container.style.cursor = 'grab';
}

// 3D animation loop
function animate3D() {
  if (!is3DActive) return;
  requestAnimationFrame(animate3D);
  // Only animate voxels if needed (e.g., for effects)
  animateVoxels();
  // Always render the scene
  if (renderer && scene && camera) {
  renderer.render(scene, camera);
}
}

// Performance monitoring
let frameCount = 0;
let lastStatsTime = Date.now();

function logPerformanceStats() {
  frameCount++;
  const now = Date.now();
  
  if (now - lastStatsTime > 5000) { // Every 5 seconds
    const fps = frameCount / 5;
    const bgTiles = nesPlanes.bg ? nesPlanes.bg.material.map.image.width : 0; // This line is removed as per new_code
    const spriteTiles = nesPlanes.sprites ? nesPlanes.sprites.material.map.image.width : 0; // This line is removed as per new_code
    const behindTiles = nesPlanes.behind ? nesPlanes.behind.material.map.image.width : 0; // This line is removed as per new_code
    
    console.log(`Fami3D Stats - FPS: ${fps.toFixed(1)}, Tiles: BG=${bgTiles}, Sprites=${spriteTiles}, Behind=${behindTiles}`);
    
    frameCount = 0;
    lastStatsTime = now;
  }
}

// File input
document.getElementById('romfile').addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(event) {
    romData = event.target.result;
    document.getElementById('startBtn').disabled = false;
    console.log('ROM loaded, startBtn enabled');
  };
  reader.readAsBinaryString(file);
});

// FirebrandX NTSC NES palette (64 RGB triplets)
const fbxPalette = [
  [124,124,124],[0,0,252],[0,0,188],[68,40,188],[148,0,132],[168,0,32],[168,16,0],[136,20,0],
  [80,48,0],[0,120,0],[0,104,0],[0,88,0],[0,64,88],[0,0,0],[0,0,0],[0,0,0],
  [188,188,188],[0,120,248],[0,88,248],[104,68,252],[216,0,204],[228,0,88],[248,56,0],[228,92,16],
  [172,124,0],[0,184,0],[0,168,0],[0,168,68],[0,136,136],[0,0,0],[0,0,0],[0,0,0],
  [248,248,248],[60,188,252],[104,136,252],[152,120,248],[248,120,248],[248,88,152],[248,120,88],[252,160,68],
  [248,184,0],[184,248,24],[88,216,84],[88,248,152],[0,232,216],[120,120,120],[0,0,0],[0,0,0],
  [252,252,252],[164,228,252],[184,184,248],[216,184,248],[248,184,248],[248,164,192],[240,208,176],[252,224,168],
  [248,216,120],[216,248,120],[184,248,184],[184,248,216],[0,252,252],[248,216,248],[0,0,0],[0,0,0]
];

// Start button
document.getElementById('startBtn').onclick = function() {
  if (!romData) return;
  if (animationId) cancelAnimationFrame(animationId);
  
  // Initialize 3D
  init3D();
  
  console.log('Starting NES emulator...');
  nes = new jsnes.NES({
    palette: fbxPalette,
    onFrame: function(buffer) {
      console.log('onFrame called');
      // buffer is Uint32Array (256*240), ARGB (JSNES default)
      for (let i = 0; i < 256 * 240; i++) {
        const c = buffer[i];
        imageData.data[i * 4 + 0] = c & 0xFF; // R
        imageData.data[i * 4 + 1] = (c >> 8) & 0xFF;  // G
        imageData.data[i * 4 + 2] = (c >> 16) & 0xFF;         // B
        imageData.data[i * 4 + 3] = 0xFF;             // A
      }
      ctx.putImageData(imageData, 0, 0);
      drawBackgroundLayer();
      drawSpriteLayer();
      // Update 3D scene (textures, voxels, etc) every NES frame
      update3DScene();
    }
  });
  nes.loadROM(romData);
  window.nes = nes; // Expose for console inspection
  let lastTime = 0;
  function frameLoop(now) {
    console.log('frameLoop tick', now);
    if (!lastTime || now - lastTime >= 1000 / 60) {
      nes.frame();
      lastTime = now;
    }
    animationId = requestAnimationFrame(frameLoop);
  }
  requestAnimationFrame(frameLoop);
};

// Toggle 3D button handler
document.getElementById('toggle3d').onclick = function() {
  const container = document.getElementById('threejs-container');
  if (container) {
    container.style.display = container.style.display === 'none' ? 'block' : 'none';
  }
};

// Voxel system initialization
function initVoxelSystem() {
  voxelGeometry = new THREE.BoxGeometry(0.5, 0.5, 0.5);
  voxelMaterial = new THREE.MeshLambertMaterial({
    transparent: true,
    opacity: 0.9
  });
  console.log('Voxel system initialized');
}

// Clear all sprite voxels from the scene
function clearSpriteVoxels() {
  spriteVoxels.forEach(voxel => {
    scene.remove(voxel);
    voxel.geometry.dispose();
    voxel.material.dispose();
  });
  spriteVoxels = [];
}

// Clear all background voxels from the scene
function clearBgVoxels() {
  bgVoxels.forEach(voxel => {
    scene.remove(voxel);
    voxel.geometry.dispose();
    voxel.material.dispose();
  });
  bgVoxels = [];
}

// Create voxels for all sprites
function createSpriteVoxels() {
  if (!window.nes || !window.nes.ppu || !useVoxelSprites) return;
  clearSpriteVoxels();
  const ppu = window.nes.ppu;
  const spriteSize = ppu.f_spriteSize ? 16 : 8;
  const scaleX = 16 / 256;
  const scaleY = 12 / 240;
  for (let i = 0; i < 64; i++) {
    let sx = ppu.sprX ? ppu.sprX[i] : 0;
    let sy = ppu.sprY ? ppu.sprY[i] : 0;
    const tileIdx = ppu.sprTile ? ppu.sprTile[i] : 0;
    let palIdx = 0;
    let priority = 0;
    let flipH = 0, flipV = 0;
    if (ppu.spriteMem && typeof ppu.spriteMem[i * 4 + 2] === 'number') {
      const attr = ppu.spriteMem[i * 4 + 2];
      palIdx = attr & 0x3;
      priority = (attr >> 5) & 1;
      flipH = (attr >> 6) & 1;
      flipV = (attr >> 7) & 1;
    }
    sy += 1;
    if (spriteSize === 8) {
      createVoxelsFor8x8Sprite(sx, sy, tileIdx, palIdx, priority, flipH, flipV, scaleX, scaleY);
  } else {
      createVoxelsFor8x16Sprite(sx, sy, tileIdx, palIdx, priority, flipH, flipV, scaleX, scaleY);
    }
  }
}

function createVoxelsFor8x8Sprite(sx, sy, tileIdx, palIdx, priority, flipH, flipV, scaleX, scaleY) {
  const ppu = window.nes.ppu;
  const ptBase = (ppu.f_spPatternTable ? 0x1000 : 0x0000);
  const ptAddr = ptBase + tileIdx * 16;
  for (let row = 0; row < 8; row++) {
    const plane0 = ppu.vramMem ? ppu.vramMem[ptAddr + row] : 0;
    const plane1 = ppu.vramMem ? ppu.vramMem[ptAddr + row + 8] : 0;
    for (let col = 0; col < 8; col++) {
      const bit0 = (plane0 >> (7 - col)) & 1;
      const bit1 = (plane1 >> (7 - col)) & 1;
      const colorIdx = (bit1 << 1) | bit0;
      if (colorIdx === 0) continue;
      const rgb = getSpriteColor(ppu, palIdx, colorIdx);
      let drawX = flipH ? (sx + 7 - col) : (sx + col);
      let drawY = flipV ? (sy + 7 - row) : (sy + row);
      createVoxel(drawX, drawY, rgb, priority, scaleX, scaleY);
    }
  }
}

function createVoxelsFor8x16Sprite(sx, sy, tileIdx, palIdx, priority, flipH, flipV, scaleX, scaleY) {
  const ppu = window.nes.ppu;
  for (let part = 0; part < 2; part++) {
    const thisTileIdx = (tileIdx & 0xFE) + part;
    const ptBase = (thisTileIdx & 1) ? 0x1000 : 0x0000;
    const ptAddr = ptBase + (thisTileIdx >> 1) * 16;
    for (let row = 0; row < 8; row++) {
      const plane0 = ppu.vramMem ? ppu.vramMem[ptAddr + row] : 0;
      const plane1 = ppu.vramMem ? ppu.vramMem[ptAddr + row + 8] : 0;
      for (let col = 0; col < 8; col++) {
        const bit0 = (plane0 >> (7 - col)) & 1;
        const bit1 = (plane1 >> (7 - col)) & 1;
        const colorIdx = (bit1 << 1) | bit0;
        if (colorIdx === 0) continue;
        const rgb = getSpriteColor(ppu, palIdx, colorIdx);
        let drawX = flipH ? (sx + 7 - col) : (sx + col);
        let drawY = flipV
          ? (sy + 15 - (row + part * 8))
          : (sy + row + part * 8);
        createVoxel(drawX, drawY, rgb, priority, scaleX, scaleY);
      }
    }
  }
}

function createVoxel(x, y, rgb, priority, scaleX, scaleY) {
  // Restore original sprite voxel logic: fixed depth, no edge logic
  const voxelDepth = 8; // or 3 for less thickness
  const zSpacing = 0.5; // or 0.18 for less thickness
  for (let z = 0; z < voxelDepth; z++) {
    const material = new THREE.MeshLambertMaterial({
      color: new THREE.Color(`rgb(${rgb[0]},${rgb[1]},${rgb[2]})`),
      transparent: true,
      opacity: 0.9
    });
    const voxel = new THREE.Mesh(voxelGeometry, material);
    voxel.position.x = (x - 128) * scaleX;
    voxel.position.y = (120 - y) * scaleY;
    const baseZ = priority === 1 ? -0.5 : 2.0;
    voxel.position.z = baseZ + (z - (voxelDepth - 1) / 2) * zSpacing;
    scene.add(voxel);
    spriteVoxels.push(voxel);
  }
}

// Animate voxels
function animateVoxels() {
  if (!useVoxelSprites || spriteVoxels.length === 0) return;
  const time = Date.now() * 0.001;
  spriteVoxels.forEach((voxel, index) => {
    const waveOffset = Math.sin(time * 2 + index * 0.1) * 0.1;
    voxel.position.z += waveOffset;
    voxel.rotation.y = time * 0.5 + index * 0.1;
  });
}

// Voxel toggle button
const toggleVoxelsBtn = document.getElementById('toggleVoxels');
toggleVoxelsBtn.onclick = function() {
  useVoxelSprites = !useVoxelSprites;
  this.textContent = useVoxelSprites ? 'Use Textured Sprites' : 'Use Voxel Sprites';
  console.log('Voxel sprites:', useVoxelSprites ? 'enabled' : 'disabled');
  update3DScene();
};

// Voxel background toggle button
const toggleVoxelBgBtn = document.getElementById('toggleVoxelBg');
toggleVoxelBgBtn.onclick = function() {
  useVoxelBg = !useVoxelBg;
  this.textContent = useVoxelBg ? 'Use Textured Background' : 'Use Voxel Background';
  console.log('Voxel background:', useVoxelBg ? 'enabled' : 'disabled');
  update3DScene();
};

// Voxelization mode toggle button
const toggleVoxelModeBtn = document.getElementById('toggleVoxelMode');
toggleVoxelModeBtn.onclick = function() {
  // Cycle through tile -> pixel -> edge -> palette -> tile
  if (voxelBgMode === 'tile') voxelBgMode = 'pixel';
  else if (voxelBgMode === 'pixel') voxelBgMode = 'edge';
  else if (voxelBgMode === 'edge') voxelBgMode = 'palette';
  else voxelBgMode = 'tile';
  this.textContent = `Voxelization: ${voxelBgMode.charAt(0).toUpperCase() + voxelBgMode.slice(1)}`;
  if (useVoxelBg) update3DScene();
};

// Swap R and B channels for CSS color
function swapRB(color) {
  color = color & 0xFFFFFF;
  const r = (color >> 16) & 0xFF;
  const g = (color >> 8) & 0xFF;
  const b = color & 0xFF;
  return (b << 16) | (g << 8) | r;
}

function drawBackgroundLayer() {
  if (!window.nes || !window.nes.ppu) return;
  const ppu = window.nes.ppu;
  bgCtx.clearRect(0, 0, 256, 240);
  // Use correct pattern table for background
  const ptBase = (ppu.f_bgPatternTable ? 0x1000 : 0x0000);
  for (let y=0; y<30; y++) for (let x=0; x<32; x++) {
    const ntAddr = 0x2000 + y*32 + x;
    const tileIdx = ppu.vramMem ? ppu.vramMem[ntAddr] : 0;
    // Attribute table is at 0x23C0 + (nametable select) * 0x400
    const ntBase = 0x2000 + ((ntAddr - 0x2000) & 0x0C00);
    const attrTableAddr = ntBase + 0x3C0 + ((y >> 2) * 8) + (x >> 2);
    let attrByte = 0;
    if (ppu.vramMem && typeof ppu.vramMem[attrTableAddr] === 'number') {
      attrByte = ppu.vramMem[attrTableAddr];
    }
    // Correct quadrant math: ((y&2)<<1)|(x&2)
    const shift = ((y & 2) << 1) | (x & 2);
    const palIdx = (attrByte >> shift) & 0x3;
    // Each tile is 16 bytes in pattern table
    const ptAddr = ptBase + tileIdx * 16;
    for (let row=0; row<8; row++) {
      const plane0 = ppu.vramMem ? ppu.vramMem[ptAddr + row] : 0;
      const plane1 = ppu.vramMem ? ppu.vramMem[ptAddr + row + 8] : 0;
      for (let col=0; col<8; col++) {
        const bit0 = (plane0 >> (7-col)) & 1;
        const bit1 = (plane1 >> (7-col)) & 1;
        const colorIdx = (bit1 << 1) | bit0;
        // NES: colorIdx==0 is always universal BG color (palette index 0)
        let paletteBase = palIdx * 4;
        let color = 0x888888;
        if (ppu.imgPalette && Array.isArray(ppu.imgPalette)) {
          if (colorIdx === 0) {
            // Universal BG color
            color = ppu.imgPalette[0];
          } else {
            color = ppu.imgPalette[paletteBase + colorIdx];
          }
        }
        bgCtx.fillStyle = `#${swapRB(color).toString(16).padStart(6,'0')}`;
        bgCtx.fillRect(x*8+col, y*8+row, 1, 1);
      }
    }
  }
}

// Helper: Get NES color from palette RAM and fbxPalette
function getSpriteColor(ppu, palIdx, colorIdx) {
  // NES palette RAM: 0x3F10 + palIdx*4 + colorIdx
  // 0x3F10 mirrors 0x3F00 for universal BG color, but for sprites use 0x3F10+
  const paletteAddr = 0x3F10 + palIdx * 4 + colorIdx;
  // Mask to 0x3F1F (palette RAM is mirrored every 0x20 bytes)
  const nesColorIdx = ppu.vramMem ? ppu.vramMem[paletteAddr & 0x3F1F] : 0;
  // Fallback to 0 if out of range
  const rgb = fbxPalette[nesColorIdx % 64] || [136,136,136];
  return rgb;
}

function drawSpriteLayer() {
  if (!window.nes || !window.nes.ppu) return;
  const ppu = window.nes.ppu;
  spriteCtx.clearRect(0, 0, 256, 240);
  spriteBehindCtx.clearRect(0, 0, 256, 240);
  const spriteSize = ppu.f_spriteSize ? 16 : 8; // 8x8 or 8x16
  for (let i = 0; i < 64; i++) {
    let sx = ppu.sprX ? ppu.sprX[i] : 0;
    let sy = ppu.sprY ? ppu.sprY[i] : 0;
    const tileIdx = ppu.sprTile ? ppu.sprTile[i] : 0;
    let palIdx = 0;
    let priority = 0;
    let flipH = 0, flipV = 0;
    if (ppu.spriteMem && typeof ppu.spriteMem[i * 4 + 2] === 'number') {
      const attr = ppu.spriteMem[i * 4 + 2];
      palIdx = attr & 0x3;
      priority = (attr >> 5) & 1;
      flipH = (attr >> 6) & 1;
      flipV = (attr >> 7) & 1;
    }
    // NES OAM Y is offset by 1
    sy += 1;
    if (spriteSize === 8) {
      const ptBase = (ppu.f_spPatternTable ? 0x1000 : 0x0000);
      const ptAddr = ptBase + tileIdx * 16;
      for (let row = 0; row < 8; row++) {
        const plane0 = ppu.vramMem ? ppu.vramMem[ptAddr + row] : 0;
        const plane1 = ppu.vramMem ? ppu.vramMem[ptAddr + row + 8] : 0;
        for (let col = 0; col < 8; col++) {
          const bit0 = (plane0 >> (7 - col)) & 1;
          const bit1 = (plane1 >> (7 - col)) & 1;
          const colorIdx = (bit1 << 1) | bit0;
          if (colorIdx === 0) continue; // transparent
          const rgb = getSpriteColor(ppu, palIdx, colorIdx);
          const ctxToUse = priority === 1 ? spriteBehindCtx : spriteCtx;
          // Handle flipping
          let drawX = flipH ? (sx + 7 - col) : (sx + col);
          let drawY = flipV ? (sy + 7 - row) : (sy + row);
          ctxToUse.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
          ctxToUse.fillRect(drawX, drawY, 1, 1);
        }
      }
    } else {
      // 8x16 sprite: two 8x8 tiles, pattern table depends on tileIdx LSB
      for (let part = 0; part < 2; part++) {
        const thisTileIdx = (tileIdx & 0xFE) + part;
        const ptBase = (thisTileIdx & 1) ? 0x1000 : 0x0000;
        const ptAddr = ptBase + (thisTileIdx >> 1) * 16;
        for (let row = 0; row < 8; row++) {
          const plane0 = ppu.vramMem ? ppu.vramMem[ptAddr + row] : 0;
          const plane1 = ppu.vramMem ? ppu.vramMem[ptAddr + row + 8] : 0;
          for (let col = 0; col < 8; col++) {
            const bit0 = (plane0 >> (7 - col)) & 1;
            const bit1 = (plane1 >> (7 - col)) & 1;
            const colorIdx = (bit1 << 1) | bit0;
            if (colorIdx === 0) continue;
            const rgb = getSpriteColor(ppu, palIdx, colorIdx);
            const ctxToUse = priority === 1 ? spriteBehindCtx : spriteCtx;
            // Handle flipping for 8x16
            let drawX = flipH ? (sx + 7 - col) : (sx + col);
            let drawY = flipV
              ? (sy + 15 - (row + part * 8))
              : (sy + row + part * 8);
            ctxToUse.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
            ctxToUse.fillRect(drawX, drawY, 1, 1);
          }
        }
      }
    }
  }
}

// Create voxels for the background layer (robust, tile, pixel, and edge modes)
function createBgVoxels() {
  if (!window.nes || !window.nes.ppu || !useVoxelBg) return;
  clearBgVoxels();
  const ppu = window.nes.ppu;
  const scaleX = 16 / 256;
  const scaleY = 12 / 240;
  let count = 0;
  if (voxelBgMode === 'tile') {
    // Per-tile voxelization (Minecraft style)
    for (let y = 0; y < 30; y++) for (let x = 0; x < 32; x++) {
      const ntAddr = 0x2000 + y * 32 + x;
      const tileIdx = ppu.vramMem ? ppu.vramMem[ntAddr] : 0;
      // Attribute table
      const ntBase = 0x2000 + ((ntAddr - 0x2000) & 0x0C00);
      const attrTableAddr = ntBase + 0x3C0 + ((y >> 2) * 8) + (x >> 2);
      let attrByte = 0;
      if (ppu.vramMem && typeof ppu.vramMem[attrTableAddr] === 'number') {
        attrByte = ppu.vramMem[attrTableAddr];
      }
      const shift = ((y & 2) << 1) | (x & 2);
      const palIdx = (attrByte >> shift) & 0x3;
      // Get tile color (use center pixel for color)
      const ptBase = (ppu.f_bgPatternTable ? 0x1000 : 0x0000);
      const ptAddr = ptBase + tileIdx * 16;
      let colorIdx = 0;
      for (let row = 0; row < 8; row++) {
        const plane0 = ppu.vramMem ? ppu.vramMem[ptAddr + row] : 0;
        const plane1 = ppu.vramMem ? ppu.vramMem[ptAddr + row + 8] : 0;
        for (let col = 0; col < 8; col++) {
          const bit0 = (plane0 >> (7 - col)) & 1;
          const bit1 = (plane1 >> (7 - col)) & 1;
          if ((bit1 << 1) | bit0) {
            colorIdx = (bit1 << 1) | bit0;
            break;
          }
        }
        if (colorIdx) break;
      }
      let paletteBase = palIdx * 4;
      let color = 0x888888;
      if (ppu.imgPalette && Array.isArray(ppu.imgPalette)) {
        if (colorIdx === 0) {
          color = ppu.imgPalette[0];
        } else {
          color = ppu.imgPalette[paletteBase + colorIdx];
        }
      }
      // Top color
      const rgb = [
        (color >> 16) & 0xFF,
        (color >> 8) & 0xFF,
        color & 0xFF
      ];
      // Side color (darker)
      const sideRgb = rgb.map(v => Math.floor(v * 0.4));
      // Block geometry
      const blockW = 8 * scaleX;
      const blockH = 8 * scaleY;
      const blockD = 2.5; // THICK
      // Top face
      const topGeom = new THREE.BoxGeometry(blockW, blockH, blockD);
      const materials = [
        new THREE.MeshLambertMaterial({ color: new THREE.Color(`rgb(${sideRgb[0]},${sideRgb[1]},${sideRgb[2]})`) }), // left
        new THREE.MeshLambertMaterial({ color: new THREE.Color(`rgb(${sideRgb[0]},${sideRgb[1]},${sideRgb[2]})`) }), // right
        new THREE.MeshLambertMaterial({ color: new THREE.Color(`rgb(${sideRgb[0]},${sideRgb[1]},${sideRgb[2]})`) }), // top
        new THREE.MeshLambertMaterial({ color: new THREE.Color(`rgb(${sideRgb[0]},${sideRgb[1]},${sideRgb[2]})`) }), // bottom
        new THREE.MeshLambertMaterial({ color: new THREE.Color(`rgb(${rgb[0]},${rgb[1]},${rgb[2]})`) }), // front (top face)
        new THREE.MeshLambertMaterial({ color: new THREE.Color(`rgb(${sideRgb[0]},${sideRgb[1]},${sideRgb[2]})`) })  // back
      ];
      const block = new THREE.Mesh(topGeom, materials);
      block.position.x = (x * 8 + 4 - 128) * scaleX;
      block.position.y = (120 - (y * 8 + 4)) * scaleY;
      block.position.z = 0;
      scene.add(block);
      bgVoxels.push(block);
      count++;
    }
  } else if (voxelBgMode === 'pixel') {
    // Per-pixel voxelization (each nonzero pixel is a voxel)
    for (let y = 0; y < 240; y++) for (let x = 0; x < 256; x++) {
      const idx = (y * 256 + x) * 4;
      // Get color from bgCanvas
      const data = bgCtx.getImageData(x, y, 1, 1).data;
      if (data[3] === 0) continue; // transparent
      // Only draw nonzero color
      if (data[0] === 0 && data[1] === 0 && data[2] === 0) continue;
      // Top color
      const rgb = [data[0], data[1], data[2]];
      // Side color (darker)
      const sideRgb = rgb.map(v => Math.floor(v * 0.4));
      // Voxel geometry
      const voxelW = scaleX;
      const voxelH = scaleY;
      const voxelD = 1.2; // THICK
      const geom = new THREE.BoxGeometry(voxelW, voxelH, voxelD);
      const materials = [
        new THREE.MeshLambertMaterial({ color: new THREE.Color(`rgb(${sideRgb[0]},${sideRgb[1]},${sideRgb[2]})`) }), // left
        new THREE.MeshLambertMaterial({ color: new THREE.Color(`rgb(${sideRgb[0]},${sideRgb[1]},${sideRgb[2]})`) }), // right
        new THREE.MeshLambertMaterial({ color: new THREE.Color(`rgb(${sideRgb[0]},${sideRgb[1]},${sideRgb[2]})`) }), // top
        new THREE.MeshLambertMaterial({ color: new THREE.Color(`rgb(${sideRgb[0]},${sideRgb[1]},${sideRgb[2]})`) }), // bottom
        new THREE.MeshLambertMaterial({ color: new THREE.Color(`rgb(${rgb[0]},${rgb[1]},${rgb[2]})`) }), // front (top face)
        new THREE.MeshLambertMaterial({ color: new THREE.Color(`rgb(${sideRgb[0]},${sideRgb[1]},${sideRgb[2]})`) })  // back
      ];
      const voxel = new THREE.Mesh(geom, materials);
      voxel.position.x = (x - 128) * scaleX;
      voxel.position.y = (120 - y) * scaleY;
      voxel.position.z = 0;
      scene.add(voxel);
      bgVoxels.push(voxel);
      count++;
    }
  } else if (voxelBgMode === 'edge') {
    // Edge-based extrusion (per-pixel edge detection)
    // 1. Get color data for the whole background
    const bgData = bgCtx.getImageData(0, 0, 256, 240).data;
    // 2. Helper to get color at (x, y) as a string
    function getColor(x, y) {
      if (x < 0 || x >= 256 || y < 0 || y >= 240) return null;
      const idx = (y * 256 + x) * 4;
      return `${bgData[idx]},${bgData[idx+1]},${bgData[idx+2]}`;
    }
    // 3. For each pixel, check if it's an edge (color differs from any neighbor)
    for (let y = 0; y < 240; y++) for (let x = 0; x < 256; x++) {
      const idx = (y * 256 + x) * 4;
      if (bgData[idx+3] === 0) continue; // transparent
      const color = getColor(x, y);
      // Check 4-neighbors
      let isEdge = false;
      for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const nColor = getColor(x+dx, y+dy);
        if (nColor !== null && nColor !== color) {
          isEdge = true;
          break;
        }
      }
      if (!isEdge) continue;
      // Top color
      const rgb = [bgData[idx], bgData[idx+1], bgData[idx+2]];
      // Side color (darker)
      const sideRgb = rgb.map(v => Math.floor(v * 0.4));
      // Voxel geometry
      const voxelW = scaleX;
      const voxelH = scaleY;
      const voxelD = 2.0; // Thicker for edge
      const geom = new THREE.BoxGeometry(voxelW, voxelH, voxelD);
      const materials = [
        new THREE.MeshLambertMaterial({ color: new THREE.Color(`rgb(${sideRgb[0]},${sideRgb[1]},${sideRgb[2]})`) }), // left
        new THREE.MeshLambertMaterial({ color: new THREE.Color(`rgb(${sideRgb[0]},${sideRgb[1]},${sideRgb[2]})`) }), // right
        new THREE.MeshLambertMaterial({ color: new THREE.Color(`rgb(${sideRgb[0]},${sideRgb[1]},${sideRgb[2]})`) }), // top
        new THREE.MeshLambertMaterial({ color: new THREE.Color(`rgb(${sideRgb[0]},${sideRgb[1]},${sideRgb[2]})`) }), // bottom
        new THREE.MeshLambertMaterial({ color: new THREE.Color(`rgb(${rgb[0]},${rgb[1]},${rgb[2]})`) }), // front (top face)
        new THREE.MeshLambertMaterial({ color: new THREE.Color(`rgb(${sideRgb[0]},${sideRgb[1]},${sideRgb[2]})`) })  // back
      ];
      const voxel = new THREE.Mesh(geom, materials);
      voxel.position.x = (x - 128) * scaleX;
      voxel.position.y = (120 - y) * scaleY;
      voxel.position.z = 0;
      scene.add(voxel);
      bgVoxels.push(voxel);
      count++;
    }
  } else if (voxelBgMode === 'palette') {
    // Palette region (attribute block) extrusion
    // NES attribute regions are 16x16 pixels, 32/2=16 x 30/2=15 regions
    // 1. Build palette index map for each region
    const regionPalIdx = [];
    for (let ry = 0; ry < 15; ry++) {
      regionPalIdx[ry] = [];
      for (let rx = 0; rx < 16; rx++) {
        // Attribute table address
        const attrTableAddr = 0x23C0 + (ry >> 1) * 8 + (rx >> 1);
        let attrByte = 0;
        if (ppu.vramMem && typeof ppu.vramMem[attrTableAddr] === 'number') {
          attrByte = ppu.vramMem[attrTableAddr];
        }
        // Which quadrant in the attribute byte?
        const shift = ((!!(ry & 1)) << 1) | (!!(rx & 1));
        const palIdx = (attrByte >> (shift * 2)) & 0x3;
        regionPalIdx[ry][rx] = palIdx;
      }
    }
    // 2. For each region, check if it's at a palette boundary
    for (let ry = 0; ry < 15; ry++) for (let rx = 0; rx < 16; rx++) {
      const palIdx = regionPalIdx[ry][rx];
      // Check 4-neighbors for palette difference
      let isEdge = false;
      for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const nx = rx + dx, ny = ry + dy;
        if (nx < 0 || nx >= 16 || ny < 0 || ny >= 15) continue;
        if (regionPalIdx[ny][nx] !== palIdx) {
          isEdge = true;
          break;
        }
      }
      if (!isEdge) continue;
      // 3. Get representative color for this region (center pixel)
      const cx = rx * 16 + 8;
      const cy = ry * 16 + 8;
      const data = bgCtx.getImageData(cx, cy, 1, 1).data;
      const rgb = [data[0], data[1], data[2]];
      const sideRgb = rgb.map(v => Math.floor(v * 0.3));
      // 4. Create a thick block for this region
      const blockW = 16 * scaleX;
      const blockH = 16 * scaleY;
      const blockD = 4.0;
      const geom = new THREE.BoxGeometry(blockW, blockH, blockD);
      const materials = [
        new THREE.MeshLambertMaterial({ color: new THREE.Color(`rgb(${sideRgb[0]},${sideRgb[1]},${sideRgb[2]})`) }), // left
        new THREE.MeshLambertMaterial({ color: new THREE.Color(`rgb(${sideRgb[0]},${sideRgb[1]},${sideRgb[2]})`) }), // right
        new THREE.MeshLambertMaterial({ color: new THREE.Color(`rgb(${sideRgb[0]},${sideRgb[1]},${sideRgb[2]})`) }), // top
        new THREE.MeshLambertMaterial({ color: new THREE.Color(`rgb(${sideRgb[0]},${sideRgb[1]},${sideRgb[2]})`) }), // bottom
        new THREE.MeshLambertMaterial({ color: new THREE.Color(`rgb(${rgb[0]},${rgb[1]},${rgb[2]})`) }), // front
        new THREE.MeshLambertMaterial({ color: new THREE.Color(`rgb(${sideRgb[0]},${sideRgb[1]},${sideRgb[2]})`) })  // back
      ];
      const block = new THREE.Mesh(geom, materials);
      block.position.x = (rx * 16 + 8 - 128) * scaleX;
      block.position.y = (120 - (ry * 16 + 8)) * scaleY;
      block.position.z = 0;
      scene.add(block);
      bgVoxels.push(block);
      count++;
    }
  }
  console.log(`[VoxelBG] Mode: ${voxelBgMode}, Voxels/Blocks: ${count}`);
}

// Optional: Add keyboard controls for enhanced navigation
document.addEventListener('keydown', (e) => {
  if (!is3DActive) return;
  
  const center = new THREE.Vector3(0, 0, 0); // This line is changed as per new_code
  const moveSpeed = 2;
  
  switch(e.key) {
    case 'w': case 'W':
      camera.position.y += moveSpeed;
      break;
    case 's': case 'S':
      camera.position.y -= moveSpeed;
      break;
    case 'a': case 'A':
      camera.position.x -= moveSpeed;
      break;
    case 'd': case 'D':
      camera.position.x += moveSpeed;
      break;
    case 'r': case 'R':
      // Reset camera
      camera.position.set(0, 0, 15); // This line is changed as per new_code
      camera.lookAt(center);
      break;
  }
});

console.log('Fami3D optimized converter loaded - Ready for tile-based 3D rendering');

});