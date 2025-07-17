console.log('script.js loaded');

window.addEventListener('DOMContentLoaded', () => {
  console.log('DOMContentLoaded fired');

  // --- Get canvas contexts ---
  const bgCanvas = document.getElementById('bgCanvas');
  const bgCtx = bgCanvas.getContext('2d');

  const spriteCanvas = document.getElementById('spriteCanvas');
  const spriteCtx = spriteCanvas.getContext('2d');

  const spriteBehindCanvas = document.getElementById('spriteBehindCanvas');
  const spriteBehindCtx = spriteBehindCanvas.getContext('2d');

  const nesCanvas = document.createElement('canvas');
  nesCanvas.width = 256; 
  nesCanvas.height = 240;
  const ctx = nesCanvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, 256, 240);

  let nes = null;
  let animationId = null;
  let romData = null;

  // ===== CENTRAL STATE FLAGS =====
  let use3D = false;
  let nesFrameChanged = false;
  let lastRenderTime = 0;
  const TARGET_FPS = 60;
  const FRAME_TIME = 1000 / TARGET_FPS;

  // ===== THREE.JS VARIABLES =====
  let threeScene, threeRenderer, threeCamera, threeControls;
  let bgTileGroup, spriteTileGroup;
  let bgTexture, spriteTexture, spriteBehindTexture;

  // ===== PERFORMANCE OPTIMIZATIONS =====
  const colorCache = new Map();
  const bgImageData = bgCtx.createImageData(256, 240);
  const spriteImageData = spriteCtx.createImageData(256, 240);
  const spriteBehindImageData = spriteBehindCtx.createImageData(256, 240);

  // ===== THREE.JS SETUP =====
  function setupThreeJS() {
    const container = document.getElementById('threejs-container');
    
    // Clear container
    container.innerHTML = '';
    
    // Renderer setup
    threeRenderer = new THREE.WebGLRenderer({ antialias: true });
    threeRenderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(threeRenderer.domElement);

    // Scene setup
    threeScene = new THREE.Scene();
    threeScene.background = new THREE.Color(0x0a0a0a);

    // Camera setup
    threeCamera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
    threeCamera.position.set(0, 20, 40);

    // Controls setup
    threeControls = new THREE.OrbitControls(threeCamera, threeRenderer.domElement);
    threeControls.enableDamping = true;
    threeControls.dampingFactor = 0.05;
    threeControls.screenSpacePanning = false;
    threeControls.minDistance = 10;
    threeControls.maxDistance = 50;
    threeControls.maxPolarAngle = Math.PI / 2;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    threeScene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 20, 10);
    directionalLight.castShadow = true;
    threeScene.add(directionalLight);

    // Grid and axes
    const gridHelper = new THREE.GridHelper(30, 30, 0x444444);
    threeScene.add(gridHelper);

    const axesHelper = new THREE.AxesHelper(5);
    threeScene.add(axesHelper);

    // Create three flat layers
    createFlatLayers();

    console.log('Three.js setup complete - flat layers');
  }

  // ===== FLAT LAYERS =====
  function createFlatLayers() {
    const planeGeometry = new THREE.PlaneGeometry(16, 12); // 256/16 = 16, 240/20 = 12
    
    // Background plane
    bgTexture = new THREE.CanvasTexture(bgCanvas);
    bgTexture.minFilter = THREE.LinearFilter;
    bgTexture.magFilter = THREE.LinearFilter;
    const bgMaterial = new THREE.MeshLambertMaterial({ 
      map: bgTexture,
      transparent: true,
      side: THREE.DoubleSide
    });
    bgTileGroup = new THREE.Mesh(planeGeometry, bgMaterial);
    bgTileGroup.position.z = 0;
    threeScene.add(bgTileGroup);
    
    // Sprite behind plane
    spriteBehindTexture = new THREE.CanvasTexture(spriteBehindCanvas);
    spriteBehindTexture.minFilter = THREE.LinearFilter;
    spriteBehindTexture.magFilter = THREE.LinearFilter;
    const spriteBehindMaterial = new THREE.MeshLambertMaterial({ 
      map: spriteBehindTexture,
      transparent: true,
      side: THREE.DoubleSide
    });
    spriteTileGroup = new THREE.Mesh(planeGeometry, spriteBehindMaterial);
    spriteTileGroup.position.z = -1.0; // Behind background
    threeScene.add(spriteTileGroup);
    
    // Sprite plane
    spriteTexture = new THREE.CanvasTexture(spriteCanvas);
    spriteTexture.minFilter = THREE.LinearFilter;
    spriteTexture.magFilter = THREE.LinearFilter;
    const spriteMaterial = new THREE.MeshLambertMaterial({ 
      map: spriteTexture,
      transparent: true,
      side: THREE.DoubleSide
    });
    const spritePlane = new THREE.Mesh(planeGeometry, spriteMaterial);
    spritePlane.position.z = 1.0; // In front of background
    threeScene.add(spritePlane);
  }

  // ===== 3D SCENE UPDATE =====
  function updateThreeScene() {
    if (!use3D || !threeScene) return;

    // Only update textures when they actually changed
    if (bgTexture) bgTexture.needsUpdate = true;
    if (spriteTexture) spriteTexture.needsUpdate = true;
    if (spriteBehindTexture) spriteBehindTexture.needsUpdate = true;

    // Render
    threeRenderer.render(threeScene, threeCamera);
  }

  // ===== MAIN RENDER LOOP =====
  function renderFrame(now) {
    // Frame rate limiting
    if (now - lastRenderTime < FRAME_TIME) {
      requestAnimationFrame(renderFrame);
      return;
    }
    lastRenderTime = now;

    if (nesFrameChanged) {
      drawLayeredCanvases(); // 2D canvas drawing
      if (use3D) {
        updateThreeScene(); // 3D from canvas pixels
      }
      nesFrameChanged = false;
    }
    requestAnimationFrame(renderFrame);
  }

  // ===== 2D CANVAS DRAWING =====
  function drawLayeredCanvases() {
    drawBackgroundLayer();
    drawSpriteLayer();
  }

  function drawBackgroundLayer() {
    if (!nes || !nes.ppu) return;
    const ppu = nes.ppu;
    
    // Clear with ImageData for better performance
    const data = bgImageData.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 0;     // R
      data[i + 1] = 0; // G
      data[i + 2] = 0; // B
      data[i + 3] = 255; // A
    }
    
    const ptBase = ppu.f_bgPatternTable ? 0x1000 : 0x0000;
    
    for (let y = 0; y < 30; y++) {
      for (let x = 0; x < 32; x++) {
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
        const ptAddr = ptBase + tileIdx * 16;
        
        for (let row = 0; row < 8; row++) {
          const plane0 = ppu.vramMem ? ppu.vramMem[ptAddr + row] : 0;
          const plane1 = ppu.vramMem ? ppu.vramMem[ptAddr + row + 8] : 0;
          
          for (let col = 0; col < 8; col++) {
            const bit0 = (plane0 >> (7 - col)) & 1;
            const bit1 = (plane1 >> (7 - col)) & 1;
            const colorIdx = (bit1 << 1) | bit0;
            
            if (colorIdx === 0) continue; // Skip transparent pixels
            
            let paletteBase = palIdx * 4;
            let color = 0x888888;
            
            if (ppu.imgPalette && Array.isArray(ppu.imgPalette)) {
              if (colorIdx === 0) {
                color = ppu.imgPalette[0];
              } else {
                color = ppu.imgPalette[paletteBase + colorIdx];
              }
            }
            
            // Use cached color conversion
            const rgb = getCachedColor(color);
            const pixelX = x * 8 + col;
            const pixelY = y * 8 + row;
            const index = (pixelY * 256 + pixelX) * 4;
            
            data[index] = rgb[0];     // R
            data[index + 1] = rgb[1]; // G
            data[index + 2] = rgb[2]; // B
            data[index + 3] = 255;    // A
          }
        }
      }
    }
    
    bgCtx.putImageData(bgImageData, 0, 0);
  }

  function drawSpriteLayer() {
    if (!nes || !nes.ppu) return;
    const ppu = nes.ppu;
    
    // Clear sprite canvases with ImageData
    const spriteData = spriteImageData.data;
    const spriteBehindData = spriteBehindImageData.data;
    
    for (let i = 0; i < spriteData.length; i += 4) {
      spriteData[i] = 0; spriteData[i + 1] = 0; spriteData[i + 2] = 0; spriteData[i + 3] = 0;
      spriteBehindData[i] = 0; spriteBehindData[i + 1] = 0; spriteBehindData[i + 2] = 0; spriteBehindData[i + 3] = 0;
    }
    
    const spriteSize = ppu.f_spriteSize ? 16 : 8;
    
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
        render8x8SpriteOptimized(sx, sy, tileIdx, palIdx, priority, flipH, flipV, ppu);
      } else {
        render8x16SpriteOptimized(sx, sy, tileIdx, palIdx, priority, flipH, flipV, ppu);
      }
    }
    
    spriteCtx.putImageData(spriteImageData, 0, 0);
    spriteBehindCtx.putImageData(spriteBehindImageData, 0, 0);
  }

  function render8x8SpriteOptimized(sx, sy, tileIdx, palIdx, priority, flipH, flipV, ppu) {
    const ptBase = ppu.f_spPatternTable ? 0x1000 : 0x0000;
    const ptAddr = ptBase + tileIdx * 16;
    const targetData = priority === 1 ? spriteBehindImageData.data : spriteImageData.data;
    
    for (let row = 0; row < 8; row++) {
      const plane0 = ppu.vramMem ? ppu.vramMem[ptAddr + row] : 0;
      const plane1 = ppu.vramMem ? ppu.vramMem[ptAddr + row + 8] : 0;
      
      for (let col = 0; col < 8; col++) {
        const bit0 = (plane0 >> (7 - col)) & 1;
        const bit1 = (plane1 >> (7 - col)) & 1;
        const colorIdx = (bit1 << 1) | bit0;
        
        if (colorIdx === 0) continue;
        
        const rgb = getSpriteColor(ppu, palIdx, colorIdx);
        const drawX = flipH ? (sx + 7 - col) : (sx + col);
        const drawY = flipV ? (sy + 7 - row) : (sy + row);
        
        if (drawX >= 0 && drawX < 256 && drawY >= 0 && drawY < 240) {
          const index = (drawY * 256 + drawX) * 4;
          targetData[index] = rgb[0];
          targetData[index + 1] = rgb[1];
          targetData[index + 2] = rgb[2];
          targetData[index + 3] = 255;
        }
      }
    }
  }

  function render8x16SpriteOptimized(sx, sy, tileIdx, palIdx, priority, flipH, flipV, ppu) {
    const targetData = priority === 1 ? spriteBehindImageData.data : spriteImageData.data;
    
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
          const drawX = flipH ? (sx + 7 - col) : (sx + col);
          const drawY = flipV ? 
            (sy + 15 - (row + part * 8)) : 
            (sy + row + part * 8);
          
          if (drawX >= 0 && drawX < 256 && drawY >= 0 && drawY < 240) {
            const index = (drawY * 256 + drawX) * 4;
            targetData[index] = rgb[0];
            targetData[index + 1] = rgb[1];
            targetData[index + 2] = rgb[2];
            targetData[index + 3] = 255;
          }
        }
      }
    }
  }

  // ===== UTILITY FUNCTIONS =====
  function getCachedColor(color) {
    if (colorCache.has(color)) {
      return colorCache.get(color);
    }
    
    const swapped = swapRB(color);
    const r = (swapped >> 16) & 0xFF;
    const g = (swapped >> 8) & 0xFF;
    const b = swapped & 0xFF;
    const result = [r, g, b];
    
    colorCache.set(color, result);
    return result;
  }

  function swapRB(color) {
    color = color & 0xFFFFFF;
    const r = (color >> 16) & 0xFF;
    const g = (color >> 8) & 0xFF;
    const b = color & 0xFF;
    return (b << 16) | (g << 8) | r;
  }

  function getSpriteColor(ppu, palIdx, colorIdx) {
    const paletteAddr = 0x3F10 + palIdx * 4 + colorIdx;
    const nesColorIdx = ppu.vramMem ? ppu.vramMem[paletteAddr & 0x3F1F] : 0;
    return fbxPalette[nesColorIdx % 64] || [136, 136, 136];
  }

  // ===== UI EVENT HANDLERS =====
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

  document.getElementById('startBtn').onclick = function() {
    if (!romData) return;
    if (animationId) cancelAnimationFrame(animationId);
    
    console.log('Starting NES emulator...');
    nes = new jsnes.NES({
      palette: fbxPalette,
      onFrame: function(buffer) {
        for (let i = 0; i < 256 * 240; i++) {
          const c = buffer[i];
          imageData.data[i * 4 + 0] = c & 0xFF;
          imageData.data[i * 4 + 1] = (c >> 8) & 0xFF;
          imageData.data[i * 4 + 2] = (c >> 16) & 0xFF;
          imageData.data[i * 4 + 3] = 0xFF;
        }
        ctx.putImageData(imageData, 0, 0);
        nesFrameChanged = true;
      }
    });
    
    nes.loadROM(romData);
    window.nes = nes;
    
    let lastTime = 0;
    function frameLoop(now) {
      if (!lastTime || now - lastTime >= 1000 / 60) {
        nes.frame();
        lastTime = now;
      }
      animationId = requestAnimationFrame(frameLoop);
    }
    requestAnimationFrame(frameLoop);
    
    // Start main render loop
    renderFrame(0);
  };

  // ===== TOGGLE BUTTON BEHAVIOR =====
  document.getElementById('toggle3d').onclick = () => {
    use3D = !use3D;
    const container = document.getElementById('threejs-container');
    container.style.display = use3D ? 'block' : 'none';
    
    if (use3D && !threeScene) {
      setupThreeJS();
    }
  };

  // ===== PALETTE =====
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

  console.log('Fami3D loaded - Optimized performance ready');
});