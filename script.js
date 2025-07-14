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
  
  // Camera setup - positioned for NES screen view
  camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 1000);
  camera.position.set(0, 0, 15);
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
  const ambientLight = new THREE.AmbientLight(0x606060, 0.6);
  scene.add(ambientLight);
  
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.6);
  directionalLight.position.set(10, 10, 10);
  directionalLight.castShadow = true;
  scene.add(directionalLight);
  
  // Create textured planes for each layer
  createNESPlanes();
  
  // Mouse controls
  setupMouseControls(container);
  
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
  
  // Subtle layer animation for depth perception
  const time = Date.now() * 0.001;
  // nesPlanes.sprites.position.z = LAYER_DEPTHS.sprites + Math.sin(time * 0.5) * 0.05; // This line is removed as per new_code
  
  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  } else {
    console.log('Missing renderer, scene, or camera:', { renderer: !!renderer, scene: !!scene, camera: !!camera });
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
      
      // Update 3D scene
      update3DScene();
    }
  });
  nes.loadROM(romData);
  window.nes = nes; // Expose for console inspection
  let lastTime = 0;
  function frameLoop(now) {
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