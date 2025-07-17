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
  let bgPanelMesh = null;

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
    threeCamera.position.set(0, 8, 16);
    threeCamera.lookAt(0, 0, 0);

    // Controls setup
    threeControls = new THREE.OrbitControls(threeCamera, threeRenderer.domElement);
    threeControls.enableDamping = true;
    threeControls.dampingFactor = 0.05;
    threeControls.screenSpacePanning = false;
    threeControls.minDistance = 14;
    threeControls.maxDistance = 22;
    // Limit vertical angle to about 73° to 107° (in radians)
    threeControls.minPolarAngle = Math.PI / 2 - 0.3;
    threeControls.maxPolarAngle = Math.PI / 2 + 0.3;
    // Limit horizontal angle to ±45° from center
    threeControls.minAzimuthAngle = -Math.PI / 4;
    threeControls.maxAzimuthAngle = Math.PI / 4;

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

    // Create 3D background tiles (no flat plane)
    create3DBackgroundTiles();

    // Add flat background panel behind tiles
    if (!bgPanelMesh) {
      // Start with a default color, will update every frame
      const bgPanelMaterial = new THREE.MeshLambertMaterial({ color: 0x000000 });
      const bgPanelGeometry = new THREE.PlaneGeometry(16, 12);
      bgPanelMesh = new THREE.Mesh(bgPanelGeometry, bgPanelMaterial);
      bgPanelMesh.position.z = -0.01; // Just behind all tiles
      threeScene.add(bgPanelMesh);
      bgPanelMesh.userData.bgPanelMaterial = bgPanelMaterial;
    }

    // Sprites as before
    createSpritePlanes();

    console.log('Three.js setup complete - 3D tiles');
  }

  // ===== TILE MESH CACHE FOR PER-PIXEL EXTRUSION =====
  const tileMeshCache = new Map(); // key: `${tileIdx}_${palIdx}` => geometry

  function createPixelExtrudedTileGeometry(tileCanvas, avgColor) {
    // Each non-background pixel becomes a small box (voxel)
    const ctx = tileCanvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, 8, 8).data;
    const geometries = [];
    for (let py = 0; py < 8; py++) {
      for (let px = 0; px < 8; px++) {
        const idx = (py * 8 + px) * 4;
        // Consider pixel non-background if alpha > 0 and not black
        if (imgData[idx + 3] > 0 && (imgData[idx] > 8 || imgData[idx + 1] > 8 || imgData[idx + 2] > 8)) {
          // Small box for this pixel
          const box = new THREE.BoxGeometry(0.0625, 0.0625, 1.0); // 1/16 NES unit
          // Position the box within the tile (centered)
          box.translate((px - 4) * 0.0625 + 0.03125, (3.5 - py) * 0.0625 + 0.03125, 0.5);
          geometries.push(box);
        }
      }
    }
    // Merge all boxes into one geometry
    if (geometries.length === 0) {
      // fallback: flat plane
      return new THREE.BoxGeometry(0.5, 0.5, 0.01);
    }
    const merged = THREE.BufferGeometryUtils.mergeBufferGeometries(geometries);
    return merged;
  }

  function getSpriteAverageColor(canvas) {
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, 256, 240).data;
    let r = 0, g = 0, b = 0, count = 0;
    for (let i = 0; i < imgData.length; i += 4) {
      if (imgData[i + 3] > 32) {
        r += imgData[i];
        g += imgData[i + 1];
        b += imgData[i + 2];
        count++;
      }
    }
    if (count === 0) return [255, 255, 255];
    r = Math.round(r / count);
    g = Math.round(g / count);
    b = Math.round(b / count);
    return [r, g, b];
  }

  function createPixelExtrudedSpriteGeometry(spriteCanvas) {
    // Each opaque pixel becomes a small box (voxel)
    const ctx = spriteCanvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, 256, 240).data;
    const geometries = [];
    for (let py = 0; py < 240; py++) {
      for (let px = 0; px < 256; px++) {
        const idx = (py * 256 + px) * 4;
        if (imgData[idx + 3] > 32) {
          // Small box for this pixel
          const box = new THREE.BoxGeometry(1 / 16, 1 / 20, 0.5); // scale to NES units
          // Position the box within the sprite (centered)
          box.translate((px - 128) / 16 + 1 / 32, (120 - py) / 20 + 1 / 40, 0.25);
          geometries.push(box);
        }
      }
    }
    if (geometries.length === 0) {
      // fallback: flat plane
      return new THREE.BoxGeometry(16, 12, 0.01);
    }
    const merged = THREE.BufferGeometryUtils.mergeBufferGeometries(geometries);
    return merged;
  }

  // ===== 3D BACKGROUND TILES (OPTIMIZED, BOXES FOR PROMINENT) =====
  let bgTileMeshes = [];
  let bgTileCanvases = [];
  let bgTileTextures = [];
  let lastProminence = [];
  let lastTileImageData = [];
  let lastTileIdx = [];
  let lastTilePal = [];
  let lastTileDepth = [];
  let bgTileOverlayPlanes = [];
  function create3DBackgroundTiles() {
    // Only create once
    if (bgTileMeshes.length) return;
    bgTileMeshes = [];
    bgTileCanvases = [];
    bgTileTextures = [];
    lastProminence = [];
    lastTileImageData = [];
    lastTileIdx = [];
    lastTilePal = [];
    lastTileDepth = [];
    bgTileOverlayPlanes = [];
    for (let ty = 0; ty < 30; ty++) {
      bgTileMeshes[ty] = [];
      bgTileCanvases[ty] = [];
      bgTileTextures[ty] = [];
      lastProminence[ty] = [];
      lastTileImageData[ty] = [];
      lastTileIdx[ty] = [];
      lastTilePal[ty] = [];
      lastTileDepth[ty] = [];
      bgTileOverlayPlanes[ty] = [];
      for (let tx = 0; tx < 32; tx++) {
        // Canvas and texture for this tile
        const tileCanvas = document.createElement('canvas');
        tileCanvas.width = 8;
        tileCanvas.height = 8;
        const tileTexture = new THREE.CanvasTexture(tileCanvas);
        tileTexture.minFilter = THREE.NearestFilter;
        tileTexture.magFilter = THREE.NearestFilter;
        // Compute average color for side faces
        const avgColor = getTileAverageColor(bgCanvas, tx, ty, 8);
        const avgColorHex = `#${((1 << 24) + (avgColor[0] << 16) + (avgColor[1] << 8) + avgColor[2]).toString(16).slice(1)}`;
        // Materials: front = texture, sides = avg color
        const matArray = [
          new THREE.MeshLambertMaterial({ color: avgColorHex }), // right
          new THREE.MeshLambertMaterial({ color: avgColorHex }), // left
          new THREE.MeshLambertMaterial({ color: avgColorHex }), // top
          new THREE.MeshLambertMaterial({ color: avgColorHex }), // bottom
          new THREE.MeshLambertMaterial({ map: tileTexture, transparent: true }), // front
          new THREE.MeshLambertMaterial({ color: avgColorHex }) // back
        ];
        // Start as a flat plane (z=0, height=0.01)
        const geo = new THREE.BoxGeometry(0.5, 0.5, 0.01);
        const mesh = new THREE.Mesh(geo, matArray);
        mesh.position.x = (tx - 16) * 0.5 + 0.25;
        mesh.position.y = (15 - ty) * 0.5 + 0.25;
        mesh.position.z = 0;
        threeScene.add(mesh);
        bgTileMeshes[ty][tx] = mesh;
        bgTileCanvases[ty][tx] = tileCanvas;
        bgTileTextures[ty][tx] = tileTexture;
        lastProminence[ty][tx] = 0;
        lastTileImageData[ty][tx] = null;
        lastTileIdx[ty][tx] = null;
        lastTilePal[ty][tx] = null;
        lastTileDepth[ty][tx] = 0.01;
        // Overlay plane for original tile
        const overlayTexture = new THREE.CanvasTexture(tileCanvas);
        overlayTexture.minFilter = THREE.NearestFilter;
        overlayTexture.magFilter = THREE.NearestFilter;
        const overlayMat = new THREE.MeshBasicMaterial({ map: overlayTexture, transparent: true });
        const overlayPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), overlayMat);
        overlayPlane.position.z = 1.01; // Just in front of the extrusion
        mesh.add(overlayPlane);
        bgTileOverlayPlanes[ty][tx] = { plane: overlayPlane, texture: overlayTexture };
      }
    }
  }

  function getTileProminenceDepth(canvas, tx, ty, tileSize, bgColor) {
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(tx * tileSize, ty * tileSize, tileSize, tileSize).data;
    let prominent = 0, total = tileSize * tileSize;
    for (let i = 0; i < imgData.length; i += 4) {
      const r = imgData[i], g = imgData[i+1], b = imgData[i+2];
      const dist = Math.sqrt(
        (r - bgColor[0]) ** 2 +
        (g - bgColor[1]) ** 2 +
        (b - bgColor[2]) ** 2
      );
      if (dist > 16) prominent++;
    }
    // Map to depth
    const minDepth = 0.01, maxDepth = 1.0;
    return minDepth + (maxDepth - minDepth) * (prominent / total);
  }

  function update3DBackgroundTiles() {
    if (!bgTileMeshes.length) return;
    // Get background color for prominence calculation
    const ctx = bgCanvas.getContext('2d');
    const bgPixel = ctx.getImageData(4, 4, 1, 1).data;
    const bgColor = [bgPixel[0], bgPixel[1], bgPixel[2]];
    let ppu = nes && nes.ppu;
    const sceneCleared = isSceneMostlyBlack(bgCanvas);
    for (let ty = 0; ty < 30; ty++) {
      for (let tx = 0; tx < 32; tx++) {
        let tileChanged = false;
        let tileIdx = null, palIdx = null;
        if (ppu && ppu.vramMem) {
          const ntAddr = 0x2000 + ty * 32 + tx;
          tileIdx = ppu.vramMem[ntAddr];
          const ntBase = 0x2000 + ((ntAddr - 0x2000) & 0x0C00);
          const attrTableAddr = ntBase + 0x3C0 + ((ty >> 2) * 8) + (tx >> 2);
          let attrByte = 0;
          if (typeof ppu.vramMem[attrTableAddr] === 'number') {
            attrByte = ppu.vramMem[attrTableAddr];
          }
          const shift = ((ty & 2) << 1) | (tx & 2);
          palIdx = (attrByte >> shift) & 0x3;
          if (lastTileIdx[ty][tx] !== tileIdx || lastTilePal[ty][tx] !== palIdx) {
            tileChanged = true;
            lastTileIdx[ty][tx] = tileIdx;
            lastTilePal[ty][tx] = palIdx;
          }
        } else {
          tileChanged = true;
        }
        // Update tile canvas/texture if changed
        if (tileChanged) {
          const tileCanvas = bgTileCanvases[ty][tx];
          const tileCtx = tileCanvas.getContext('2d');
          tileCtx.clearRect(0, 0, 8, 8);
          tileCtx.drawImage(bgCanvas, tx * 8, ty * 8, 8, 8, 0, 0, 8, 8);
          bgTileTextures[ty][tx].needsUpdate = true;
          // Also update overlay plane texture
          if (bgTileOverlayPlanes[ty] && bgTileOverlayPlanes[ty][tx]) {
            bgTileOverlayPlanes[ty][tx].texture.needsUpdate = true;
          }
        }
        // Compute per-pixel silhouette extrusion for this tile
        const mesh = bgTileMeshes[ty][tx];
        let tileInvisible = sceneCleared || isTileMostlyBlack(bgCanvas, tx, ty, 8);
        if (tileInvisible) {
          mesh.visible = false;
        } else {
          mesh.visible = true;
          // Use cache key based on tileIdx and palIdx
          const cacheKey = `${tileIdx}_${palIdx}`;
          let geometry = tileMeshCache.get(cacheKey);
          if (!geometry) {
            // Generate geometry for this tile
            const tileCanvas = bgTileCanvases[ty][tx];
            const avgColor = getTileAverageColor(bgCanvas, tx, ty, 8);
            geometry = createPixelExtrudedTileGeometry(tileCanvas, avgColor);
            tileMeshCache.set(cacheKey, geometry);
          }
          if (mesh.geometry !== geometry) {
            mesh.geometry.dispose();
            mesh.geometry = geometry;
            // Assign a single material with the average color for merged geometry
            const avgColor = getTileAverageColor(bgCanvas, tx, ty, 8);
            const avgColorHex = `#${((1 << 24) + (avgColor[0] << 16) + (avgColor[1] << 8) + avgColor[2]).toString(16).slice(1)}`;
            mesh.material = new THREE.MeshLambertMaterial({ color: avgColorHex });
          }
          // Overlay plane is always on top, texture updated above if needed
        }
      }
    }
  }

  // === Helper: get average color of a tile ===
  function getTileAverageColor(canvas, tx, ty, tileSize) {
    const ctx = canvas.getContext('2d');
    const { width } = canvas;
    const imgData = ctx.getImageData(tx * tileSize, ty * tileSize, tileSize, tileSize).data;
    let r = 0, g = 0, b = 0, count = 0;
    for (let i = 0; i < imgData.length; i += 4) {
      r += imgData[i];
      g += imgData[i + 1];
      b += imgData[i + 2];
      count++;
    }
    r = Math.round(r / count);
    g = Math.round(g / count);
    b = Math.round(b / count);
    return [r, g, b];
  }

  // === Helper: check if a tile is mostly black (98%+) ===
  function isTileMostlyBlack(canvas, tx, ty, tileSize) {
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(tx * tileSize, ty * tileSize, tileSize, tileSize).data;
    let blackCount = 0, total = imgData.length / 4;
    for (let i = 0; i < imgData.length; i += 4) {
      if (imgData[i] < 8 && imgData[i + 1] < 8 && imgData[i + 2] < 8) blackCount++;
    }
    return (blackCount / total) > 0.98;
  }

  // === Helper: check if the whole scene is mostly black (98%+) ===
  function isSceneMostlyBlack(canvas) {
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const imgData = ctx.getImageData(0, 0, width, height).data;
    let blackCount = 0, total = imgData.length / 4;
    for (let i = 0; i < imgData.length; i += 4) {
      if (imgData[i] < 8 && imgData[i + 1] < 8 && imgData[i + 2] < 8) blackCount++;
    }
    return (blackCount / total) > 0.98;
  }

  // Helper: compute sprite extrusion depth based on opaque pixels
  function getSpriteExtrusionDepth(canvas) {
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, 256, 240).data;
    let opaque = 0, total = 256 * 240;
    for (let i = 0; i < imgData.length; i += 4) {
      if (imgData[i + 3] > 32) opaque++;
    }
    // Map proportion to depth: min 0.05, max 1.0
    const prop = opaque / total;
    return 0.05 + 0.95 * prop;
  }

  // Store sprite meshes for update
  let spriteBoxMesh = null;
  let spriteBehindBoxMesh = null;

  // ===== SPRITE PLANES (unchanged) =====
  function createSpritePlanes() {
    // Sprite behind box
    spriteBehindTexture = new THREE.CanvasTexture(spriteBehindCanvas);
    spriteBehindTexture.minFilter = THREE.LinearFilter;
    spriteBehindTexture.magFilter = THREE.LinearFilter;
    const spriteBehindMatArray = [
      new THREE.MeshLambertMaterial({ color: 0x000000 }), // right
      new THREE.MeshLambertMaterial({ color: 0x000000 }), // left
      new THREE.MeshLambertMaterial({ color: 0x000000 }), // top
      new THREE.MeshLambertMaterial({ color: 0x000000 }), // bottom
      new THREE.MeshLambertMaterial({ map: spriteBehindTexture, transparent: true }), // front
      new THREE.MeshLambertMaterial({ color: 0x000000 }) // back
    ];
    spriteBehindBoxMesh = new THREE.Mesh(new THREE.BoxGeometry(16, 12, 0.1), spriteBehindMatArray);
    spriteBehindBoxMesh.position.z = -0.6;
    threeScene.add(spriteBehindBoxMesh);
    spriteTileGroup = spriteBehindBoxMesh;
    // (No overlay plane for sprite behind)

    // Sprite box
    spriteTexture = new THREE.CanvasTexture(spriteCanvas);
    spriteTexture.minFilter = THREE.LinearFilter;
    spriteTexture.magFilter = THREE.LinearFilter;
    const spriteMatArray = [
      new THREE.MeshLambertMaterial({ color: 0x000000 }), // right
      new THREE.MeshLambertMaterial({ color: 0x000000 }), // left
      new THREE.MeshLambertMaterial({ color: 0x000000 }), // top
      new THREE.MeshLambertMaterial({ color: 0x000000 }), // bottom
      new THREE.MeshLambertMaterial({ map: spriteTexture, transparent: true }), // front
      new THREE.MeshLambertMaterial({ color: 0x000000 }) // back
    ];
    spriteBoxMesh = new THREE.Mesh(new THREE.BoxGeometry(16, 12, 0.1), spriteMatArray);
    spriteBoxMesh.position.z = 2.1;
    threeScene.add(spriteBoxMesh);
    // (No overlay plane for main sprite)
  }

  // ===== 3D SCENE UPDATE =====
  function updateThreeScene() {
    if (!use3D || !threeScene) return;
    update3DBackgroundTiles();
    if (spriteTexture) spriteTexture.needsUpdate = true;
    if (spriteBehindTexture) spriteBehindTexture.needsUpdate = true;
    // (No sprite overlay texture updates)
    // Per-pixel extrusion for main sprite
    if (spriteBoxMesh) {
      const geometry = createPixelExtrudedSpriteGeometry(spriteCanvas);
      spriteBoxMesh.geometry.dispose();
      spriteBoxMesh.geometry = geometry;
      const avgColor = getSpriteAverageColor(spriteCanvas);
      const avgColorHex = `#${((1 << 24) + (avgColor[0] << 16) + (avgColor[1] << 8) + avgColor[2]).toString(16).slice(1)}`;
      spriteBoxMesh.material = new THREE.MeshLambertMaterial({ color: avgColorHex });
      spriteBoxMesh.position.z = 2.1 + 0.25; // keep front face at same z
    }
    // Per-pixel extrusion for sprite behind
    if (spriteBehindBoxMesh) {
      const geometry = createPixelExtrudedSpriteGeometry(spriteBehindCanvas);
      spriteBehindBoxMesh.geometry.dispose();
      spriteBehindBoxMesh.geometry = geometry;
      const avgColor = getSpriteAverageColor(spriteBehindCanvas);
      const avgColorHex = `#${((1 << 24) + (avgColor[0] << 16) + (avgColor[1] << 8) + avgColor[2]).toString(16).slice(1)}`;
      spriteBehindBoxMesh.material = new THREE.MeshLambertMaterial({ color: avgColorHex });
      spriteBehindBoxMesh.position.z = -0.6 + 0.25;
    }
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

    // === Tile prominence analysis ===
    const prominence = getTileProminenceMap(bgCanvas, 8);
    console.log('Tile prominence map:', prominence);
  }

  // === Tile prominence analysis function ===
  function getTileProminenceMap(canvas, tileSize = 8) {
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const imgData = ctx.getImageData(0, 0, width, height).data;

    // 1. Sample background color at (4,4)
    const bgIdx = (4 * width + 4) * 4;
    const bgColor = [
      imgData[bgIdx],
      imgData[bgIdx + 1],
      imgData[bgIdx + 2]
    ];

    // Helper: color distance
    function colorDist(a, b) {
      return Math.sqrt(
        (a[0] - b[0]) ** 2 +
        (a[1] - b[1]) ** 2 +
        (a[2] - b[2]) ** 2
      );
    }

    const prominence = [];
    for (let ty = 0; ty < height / tileSize; ty++) {
      prominence[ty] = [];
      for (let tx = 0; tx < width / tileSize; tx++) {
        // Average color of tile
        let r = 0, g = 0, b = 0, count = 0;
        for (let y = 0; y < tileSize; y++) {
          for (let x = 0; x < tileSize; x++) {
            const px = tx * tileSize + x;
            const py = ty * tileSize + y;
            const idx = (py * width + px) * 4;
            r += imgData[idx];
            g += imgData[idx + 1];
            b += imgData[idx + 2];
            count++;
          }
        }
        r /= count; g /= count; b /= count;
        const avgColor = [r, g, b];

        // Compare to background
        const dist = colorDist(avgColor, bgColor);
        // Threshold: tune as needed (e.g. 16)
        prominence[ty][tx] = dist > 16 ? 1 : 0;
      }
    }
    return prominence;
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

  // ===== AUDIO SETUP =====
  let nesAudioPlayer = null;

  // ===== BACKGROUND COLOR UPDATE TIMER =====
  let bgPanelColorTimer = null;
  let bgPanelColorInterval = null;
  function updateBgPanelColor() {
    if (bgPanelMesh && bgPanelMesh.userData.bgPanelMaterial) {
      // Use NES universal background color (palette $3F00) if available
      let hex = 0x000000;
      if (window.nes && nes.ppu && nes.ppu.vramMem && typeof fbxPalette !== 'undefined') {
        const bgColorIdx = nes.ppu.vramMem[0x3F00] || 0;
        const rgb = fbxPalette[bgColorIdx % 64] || [0,0,0];
        hex = (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
      } else {
        // Fallback: sample from bgCanvas only
        const ctx = bgCanvas.getContext('2d');
        const pixel = ctx.getImageData(0, 0, 1, 1).data;
        hex = (pixel[0] << 16) | (pixel[1] << 8) | pixel[2];
      }
      bgPanelMesh.userData.bgPanelMaterial.color.setHex(hex);
    }
  }

  document.getElementById('startBtn').onclick = function() {
    if (!romData) return;
    if (animationId) cancelAnimationFrame(animationId);
    // Re-initialize NES canvas and imageData for a clean start
    const nesCanvas = document.createElement('canvas');
    nesCanvas.width = 256;
    nesCanvas.height = 240;
    const ctx = nesCanvas.getContext('2d');
    let imageData = ctx.getImageData(0, 0, 256, 240);
    window.nesCanvas = nesCanvas; // for debugging
    window.nesCtx = ctx;
    window.nesImageData = imageData;

    // ===== AUDIO: Create WebAudioPlayer if not already =====
    if (!nesAudioPlayer && window.jsnes && jsnes.WebAudioPlayer) {
      nesAudioPlayer = new jsnes.WebAudioPlayer();
    }
    // Resume audio context on user gesture (required by browsers)
    if (nesAudioPlayer && nesAudioPlayer.ctx && nesAudioPlayer.ctx.state === 'suspended') {
      nesAudioPlayer.ctx.resume();
    }

    // Reset tile caches and mesh visibility
    if (typeof lastTileImageData !== 'undefined') {
      for (let ty = 0; ty < lastTileImageData.length; ty++) {
        if (lastTileImageData[ty]) {
          for (let tx = 0; tx < lastTileImageData[ty].length; tx++) {
            lastTileImageData[ty][tx] = null;
            if (bgTileMeshes[ty] && bgTileMeshes[ty][tx]) {
              bgTileMeshes[ty][tx].visible = true;
            }
          }
        }
      }
    }
    if (typeof lastTileIdx !== 'undefined') {
      for (let ty = 0; ty < lastTileIdx.length; ty++) {
        if (lastTileIdx[ty]) {
          for (let tx = 0; tx < lastTileIdx[ty].length; tx++) {
            lastTileIdx[ty][tx] = null;
          }
        }
      }
    }
    if (typeof lastTilePal !== 'undefined') {
      for (let ty = 0; ty < lastTilePal.length; ty++) {
        if (lastTilePal[ty]) {
          for (let tx = 0; tx < lastTilePal[ty].length; tx++) {
            lastTilePal[ty][tx] = null;
          }
        }
      }
    }
    if (typeof lastProminence !== 'undefined') {
      for (let ty = 0; ty < lastProminence.length; ty++) {
        if (lastProminence[ty]) {
          for (let tx = 0; tx < lastProminence[ty].length; tx++) {
            lastProminence[ty][tx] = null;
          }
        }
      }
    }
    if (typeof lastTileDepth !== 'undefined') {
      for (let ty = 0; ty < lastTileDepth.length; ty++) {
        if (lastTileDepth[ty]) {
          for (let tx = 0; tx < lastTileDepth[ty].length; tx++) {
            lastTileDepth[ty][tx] = null;
          }
        }
      }
    }

    console.log('Starting NES emulator...');
    nes = new jsnes.NES({
      palette: fbxPalette,
      onFrame: function(buffer) {
        if (!imageData || !ctx) return;
        for (let i = 0; i < 256 * 240; i++) {
          const c = buffer[i];
          imageData.data[i * 4 + 0] = c & 0xFF;
          imageData.data[i * 4 + 1] = (c >> 8) & 0xFF;
          imageData.data[i * 4 + 2] = (c >> 16) & 0xFF;
          imageData.data[i * 4 + 3] = 0xFF;
        }
        ctx.putImageData(imageData, 0, 0);
        nesFrameChanged = true;
        // Invalidate all cached tile images so they update on next 3D update
        if (lastTileImageData && lastTileImageData.length) {
          for (let ty = 0; ty < lastTileImageData.length; ty++) {
            if (lastTileImageData[ty]) {
              for (let tx = 0; tx < lastTileImageData[ty].length; tx++) {
                lastTileImageData[ty][tx] = null;
              }
            }
          }
        }
      },
      audio: nesAudioPlayer
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

    // ===== BACKGROUND COLOR TIMER: update 2s after start, then every 10s =====
    if (bgPanelColorTimer) clearTimeout(bgPanelColorTimer);
    if (bgPanelColorInterval) clearInterval(bgPanelColorInterval);
    bgPanelColorTimer = setTimeout(() => {
      updateBgPanelColor();
      bgPanelColorInterval = setInterval(updateBgPanelColor, 10000);
    }, 2000);
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