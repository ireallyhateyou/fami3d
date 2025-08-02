window.addEventListener('DOMContentLoaded', () => {
  // Help button functionality
  const helpBtn = document.getElementById('helpBtn');
  const helpModal = document.getElementById('helpModal');
  const closeHelpModal = document.getElementById('closeHelpModal');
  
  console.log('Help elements found:', { helpBtn, helpModal, closeHelpModal });
  
  helpBtn.addEventListener('click', () => {
    helpModal.classList.add('show');
  });
  
  closeHelpModal.addEventListener('click', (e) => {
    console.log('Close button clicked');
    e.preventDefault();
    e.stopPropagation();
    helpModal.classList.remove('show');
  });
  
  // Also allow clicking outside the modal to close it
  helpModal.addEventListener('click', (e) => {
    if (e.target === helpModal) {
      helpModal.classList.remove('show');
    }
  });
  
  // Allow Escape key to close modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && helpModal.classList.contains('show')) {
      helpModal.classList.remove('show');
    }
  });

  // Setup VR after DOM elements are available
  console.log('Setting up VR...');
  setupVR();
  console.log('VR setup complete');

  // === Library menu popup logic ===
  const menuBtn = document.getElementById('menuBtn');
  const libraryModal = document.getElementById('libraryModal');
  const closeLibraryModal = document.getElementById('closeLibraryModal');
  menuBtn.addEventListener('click', () => {
    libraryModal.classList.add('show');
  });
  closeLibraryModal.addEventListener('click', () => {
    libraryModal.classList.remove('show');
  });
  // Clicking outside the modal closes it
  libraryModal.addEventListener('click', (e) => {
    if (e.target === libraryModal) libraryModal.classList.remove('show');
  });
  // ROM library buttons
  document.querySelectorAll('.rom-library-btn').forEach(btn => {
    btn.addEventListener('click', async function() {
      const url = this.getAttribute('data-rom-url');
      if (!url) return;
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Failed to fetch ROM');
        const arrayBuffer = await response.arrayBuffer();
        romData = arrayBufferToBinaryString(arrayBuffer); // Always use binary string for jsnes
        libraryModal.classList.remove('show');
        startNesEmulator();
      } catch (err) {
        console.error('Failed to load ROM:', err);
      }
    });
  });

  // --- Get canvas contexts ---
  const bgCanvas = document.getElementById('bgCanvas');
  const bgCtx = bgCanvas.getContext('2d', { willReadFrequently: true });

  const spriteCanvas = document.getElementById('spriteCanvas');
  const spriteCtx = spriteCanvas.getContext('2d', { willReadFrequently: true });

  const spriteBehindCanvas = document.getElementById('spriteBehindCanvas');
  const spriteBehindCtx = spriteBehindCanvas.getContext('2d', { willReadFrequently: true });

  const nesCanvas = document.createElement('canvas');
    nesCanvas.width = 256; 
    nesCanvas.height = 240;
  const ctx = nesCanvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, 256, 240);

  let nes = null;
  let animationId = null;
  let romData = null;

  // ===== CENTRAL STATE FLAGS =====
  let use3D = true; // Always use 3D mode
  let nesFrameChanged = false;
  let lastRenderTime = 0;
  const TARGET_FPS = 60;
  const FRAME_TIME = 1000 / TARGET_FPS;

  // ===== THREE.JS VARIABLES =====
  let threeScene, threeRenderer, threeCamera, threeControls;
  let bgTileGroup, spriteTileGroup;
  let bgTexture, spriteTexture, spriteBehindTexture;
  let bgPanelMesh = null;

  // ===== VR VARIABLES =====
  let vrSession = null;
  let vrRenderer = null;
  let vrCamera = null;
  let vrControls = null;
  let isInVR = false;
  let vrReferenceSpace = null;
  let vrInputSources = [];
  var vrButton = null;

  // ===== PERFORMANCE OPTIMIZATIONS =====
  const colorCache = new Map();
  const bgImageData = bgCtx.createImageData(256, 240);
  const spriteImageData = spriteCtx.createImageData(256, 240);
  const spriteBehindImageData = spriteBehindCtx.createImageData(256, 240);
  
  let lastFrameTime = 0;
  const FRAME_THROTTLE = 16; // ~60fps max

  // ===== TILE MESH CACHE FOR PER-PIXEL EXTRUSION =====
  const tileMeshCache = new Map(); // key: `${tileIdx}_${palIdx}_${bgColorKey}` => geometry
  const spriteMeshCache = new Map(); // key: `sprite_${canvasHash}` => array of voxel meshes
  const spriteBehindMeshCache = new Map(); // key: `spriteBehind_${canvasHash}` => array of voxel meshes

  // ===== PERFORMANCE OPTIMIZATIONS =====
  let lastSpriteHash = '';
  let lastSpriteBehindHash = '';
  let frameSkipCounter = 0;
  const FRAME_SKIP_INTERVAL = 3; // Update sprites every 3 frames
  const MAX_VOXELS_PER_SPRITE = 1000; // Limit voxels for performance

  // ===== FAST RENDERING APPROACH =====
  // Use instanced rendering and merged geometries instead of individual voxels
  let spriteInstancedMesh = null;
  let spriteBehindInstancedMesh = null;
  let tileInstancedMeshes = []; // Array of instanced meshes for tiles
  const INSTANCE_LIMIT = 10000; // Maximum instances per mesh

  // ===== AGGRESSIVE PERFORMANCE OPTIMIZATIONS =====
  let lastTileHash = '';
  let tileUpdateCounter = 0;
  const TILE_UPDATE_INTERVAL = 5; // Update tiles every 5 frames
  const VOXEL_SAMPLE_RATE = 16; // Sample every 16th pixel (16x16 grid)
  const MAX_TILE_VOXELS = 50; // Maximum voxels per tile
  const SPRITE_SAMPLE_RATE = 8; // Sample every 8th pixel for sprites

  // ===== THREE.JS SETUP =====
  function setupThreeJS() {
  const container = document.getElementById('threejs-container');
    
    // Clear container
    container.innerHTML = '';
    
    // Renderer setup
    threeRenderer = new THREE.WebGLRenderer({ 
      antialias: true,
      powerPreference: "high-performance",
      stencil: false,
      depth: true
    });
    threeRenderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(threeRenderer.domElement);
  
    // Scene setup
    threeScene = new THREE.Scene();
    threeScene.background = new THREE.Color(0x0a0a0a);

    // Camera setup
    threeCamera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    // Place camera level with the NES screen, not above
    threeCamera.position.set(0, 0, 16); // y=0 (level), z=16 (distance)
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

    // Create 3D background tiles (no flat plane)
    create3DBackgroundTiles();

    console.log('Three.js setup complete - 3D tiles and sprites');
  }

  // ===== VR FUNCTIONS =====
  function setupVR() {
    try {
      const vrButtonElement = document.getElementById('vrBtn');
      if (!vrButtonElement) {
        console.log('VR button not found');
        return;
      }
      
      // Assign to global variable
      vrButton = vrButtonElement;

      // Make VR button visible by default
      vrButton.style.display = 'inline-flex';
      vrButton.style.alignItems = 'center';
      vrButton.style.justifyContent = 'center';

      // Check if WebXR is supported
      if (!navigator.xr) {
        console.log('WebXR not supported');
        vrButton.style.opacity = '0.5';
        vrButton.title = 'VR not supported in this browser';
        vrButton.textContent = 'VR';
        vrButton.addEventListener('click', () => {
          alert('VR is not supported in this browser. Try using Chrome, Firefox, or Edge with WebXR support.');
        });
        return;
      }

      // Check if VR is available
      const buttonElement = vrButtonElement; // Capture the button element locally
      navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
        if (supported) {
            buttonElement.addEventListener('click', onVRButtonClick);
            buttonElement.title = 'Enter Virtual Reality Mode';
            console.log('VR supported');
        } else {
            console.log('VR not supported');
            buttonElement.style.opacity = '0.5';
            buttonElement.title = 'VR not supported on this device';
            buttonElement.textContent = 'VR';
            buttonElement.addEventListener('click', () => {
              alert('VR is not supported on this device. You need a VR headset or VR-capable device.');
            });
        }
      }).catch((error) => {
        console.error('VR support check failed:', error);
        buttonElement.style.opacity = '0.5';
        buttonElement.textContent = 'VR';
        if (error.name === 'SecurityError') { 
          buttonElement.title = 'VR blocked by browser permissions';
          buttonElement.addEventListener('click', () => {
            alert('VR is blocked by browser permissions. Please allow VR access in your browser settings.');
          });
        } else {
          buttonElement.title = 'VR support check failed';
          buttonElement.addEventListener('click', () => {
            alert('VR support check failed. Please try refreshing the page or using a different browser.');
          });
        }
      });
      } catch (error) {
        console.error('Error setting up VR:', error);
      }
  }

  function onVRButtonClick() {
    if (isInVR) {
      exitVR();
    } else {
      enterVR();
    }
  }

  function enterVR() {
    if (!navigator.xr) return;

    const sessionOptions = {
      optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking']
    };

    navigator.xr.requestSession('immersive-vr', sessionOptions).then((session) => {
      vrSession = session;
      isInVR = true;
      vrButton.classList.add('active');
      vrButton.textContent = 'Exit VR';

      // Enable VR on existing renderer
      threeRenderer.xr.enabled = true;
      threeRenderer.xr.setReferenceSpaceType('local');

      // Use existing camera but adjust position for VR
      vrCamera = threeCamera;
      vrCamera.position.set(0, 1.6, 6); // Eye level, closer to screen for better immersion
      vrCamera.lookAt(0, 0, 0);
      
      // Adjust camera for VR comfort
      vrCamera.fov = 70;
      vrCamera.updateProjectionMatrix();

      // Setup VR controls
      vrControls = new THREE.VRControls(vrCamera);
      vrControls.setSize(window.innerWidth, window.innerHeight);

      // Add VR-specific lighting and environment
      setupVREnvironment();
      
      // Optimize scene for VR
      optimizeSceneForVR();

      // Handle VR session events
      session.addEventListener('end', onSessionEnd);
      session.addEventListener('select', onSelect);
      session.addEventListener('selectstart', onSelectStart);
      session.addEventListener('selectend', onSelectEnd);

      // Start VR session
      threeRenderer.setAnimationLoop(onVRRender);
      session.requestReferenceSpace('local').then((referenceSpace) => {
        vrReferenceSpace = referenceSpace;
        session.requestAnimationFrame(onVRFrame);
      });

      console.log('Entered VR mode');
      
      // Show VR status
      vrButton.style.background = 'linear-gradient(45deg, #f44336, #d32f2f)';
      vrButton.textContent = 'Exit VR';
    }).catch((error) => {
      console.error('Failed to enter VR:', error);
      alert('Failed to enter VR mode. Please make sure your VR headset is connected and try again.');
    });
  }

  function exitVR() {
    if (vrSession) {
      vrSession.end();
    }
  }

  function onSessionEnd() {
    isInVR = false;
    vrButton.classList.remove('active');
    vrButton.textContent = 'VR';
    
    // Disable VR on renderer
    if (threeRenderer) {
      threeRenderer.xr.enabled = false;
      threeRenderer.setAnimationLoop(null);
    }
    
    // Reset camera position
    if (threeCamera) {
      threeCamera.position.set(0, 0, 16);
      threeCamera.lookAt(0, 0, 0);
    }
    
    vrSession = null;
    vrCamera = null;
    vrControls = null;
    console.log('Exited VR mode');
  }

  function onSelect(event) {
    // Handle VR controller input
    console.log('VR select event');
  }

  function onSelectStart(event) {
    // Handle VR controller button press start
  }

  function onSelectEnd(event) {
    // Handle VR controller button press end
  }

  function onVRFrame(time, frame) {
    if (vrSession) {
      vrSession.requestAnimationFrame(onVRFrame);
    }
  }

  function onVRRender() {
    if (!isInVR || !threeRenderer || !vrCamera) return;

    // Update VR controls
    if (vrControls) {
      vrControls.update();
    }

    // Handle VR input
    handleVRInput();

    // Update 3D scene if needed
    if (nesFrameChanged) {
      updateThreeScene();
      nesFrameChanged = false;
    }

    // Render the scene for VR
    threeRenderer.render(threeScene, vrCamera);
  }

  // ===== VR ENVIRONMENT SETUP =====
  function setupVREnvironment() {
    // Add ambient lighting for better VR visibility
    const vrAmbientLight = new THREE.AmbientLight(0xffffff, 0.8);
    threeScene.add(vrAmbientLight);

    // Add directional lighting from above
    const vrDirectionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    vrDirectionalLight.position.set(0, 10, 5);
    vrDirectionalLight.castShadow = true;
    threeScene.add(vrDirectionalLight);

    // Add a subtle room environment (optional)
    const roomGeometry = new THREE.BoxGeometry(20, 10, 20);
    const roomMaterial = new THREE.MeshBasicMaterial({
      color: 0x222222,
      transparent: true,
      opacity: 0.1,
      side: THREE.BackSide
    });
    const room = new THREE.Mesh(roomGeometry, roomMaterial);
    room.position.set(0, 0, 0);
    threeScene.add(room);
  }

  // ===== VR PERFORMANCE OPTIMIZATION =====
  function optimizeSceneForVR() {
    // Reduce LOD for better VR performance
    if (threeRenderer) {
      threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    }
    
    // Optimize camera settings for VR
    if (vrCamera) {
      vrCamera.fov = 70; // Standard VR FOV
      vrCamera.updateProjectionMatrix();
    }
    
    // Enable shadows for better VR immersion
    if (threeRenderer) {
      threeRenderer.shadowMap.enabled = true;
      threeRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
  }

  // ===== VR CONTROLLER INPUT HANDLING =====
  function handleVRInput() {
    if (!isInVR || !vrSession) return;

    // Get input sources
    vrSession.inputSources.forEach((inputSource) => {
      if (inputSource.handedness === 'right') {
        // Handle right controller
        if (inputSource.gamepad) {
          const gamepad = inputSource.gamepad;
          // Map controller buttons to NES controls
          if (gamepad.buttons[0] && gamepad.buttons[0].pressed) {
            // A button
            nes.buttonDown(1, 0);
          } else {
            nes.buttonUp(1, 0);
          }
          if (gamepad.buttons[1] && gamepad.buttons[1].pressed) {
            // B button
            nes.buttonDown(1, 1);
          } else {
            nes.buttonUp(1, 1);
          }
          if (gamepad.buttons[2] && gamepad.buttons[2].pressed) {
            // Select button
            nes.buttonDown(1, 2);
          } else {
            nes.buttonUp(1, 2);
          }
          if (gamepad.buttons[3] && gamepad.buttons[3].pressed) {
            // Start button
            nes.buttonDown(1, 3);
          } else {
            nes.buttonUp(1, 3);
          }

          // Handle thumbstick for D-pad
          if (gamepad.axes && gamepad.axes.length >= 2) {
            const x = gamepad.axes[0];
            const y = gamepad.axes[1];
            const threshold = 0.5;

            // D-pad mapping
            if (y < -threshold) {
              nes.buttonDown(1, 4); // Up
            } else {
              nes.buttonUp(1, 4);
            }
            if (y > threshold) {
              nes.buttonDown(1, 5); // Down
            } else {
              nes.buttonUp(1, 5);
            }
            if (x < -threshold) {
              nes.buttonDown(1, 6); // Left
            } else {
              nes.buttonUp(1, 6);
            }
            if (x > threshold) {
              nes.buttonDown(1, 7); // Right
            } else {
              nes.buttonUp(1, 7);
            }
          }
        }
      }
    });
  }

  function createPixelExtrudedTileGeometry(tileCanvas, avgColor, cacheKey) {
    // Aggressive cache: only generate if not present
    const cached = tileMeshCache.get(cacheKey);
    if (cached) return cached.clone();
    // Per-pixel voxel extrusion, all voxels use the average color
    const ctx = tileCanvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, 8, 8).data;
    const bgCtx = bgCanvas.getContext('2d');
    const bgPixelData = bgCtx.getImageData(5, 5, 1, 1).data;
    const bgColor = [bgPixelData[0], bgPixelData[1], bgPixelData[2]];
    const avgColorHex = (avgColor[0] << 16) | (avgColor[1] << 8) | avgColor[2];
    const geometries = [];
    let hasVoxel = false;
    for (let py = 0; py < 8; py++) {
      for (let px = 0; px < 8; px++) {
        const idx = (py * 8 + px) * 4;
        const r = imgData[idx];
        const g = imgData[idx + 1];
        const b = imgData[idx + 2];
        const dist = Math.sqrt(
          (r - bgColor[0]) ** 2 +
          (g - bgColor[1]) ** 2 +
          (b - bgColor[2]) ** 2
        );
        if (imgData[idx + 3] > 0 && dist > 8) {
          // Move voxel geometry a tiny bit farther back to avoid Z-fighting with overlay
          const voxelDepth = 0.35;
          // Offset by an extra 0.03 units farther back
          const box = new THREE.BoxGeometry(0.0625, 0.0625, voxelDepth);
          box.translate((px - 4) * 0.0625 + 0.03125, (3.5 - py) * 0.0625 + 0.03125, 1.01 - voxelDepth/2 - 0.03);
          geometries.push(box);
          hasVoxel = true;
        }
      }
    }
    if (!hasVoxel) {
      tileMeshCache.set(cacheKey, null);
      return null;
    }
    const merged = THREE.BufferGeometryUtils.mergeBufferGeometries(geometries);
    tileMeshCache.set(cacheKey, merged.clone());
    return merged.clone();
  }

  function getSpriteAverageColor(canvas) {
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, 256, 240).data;
    let r = 0, g = 0, b = 0, count = 0;
    
    // Get background color by sampling pixel (5,5) from background canvas (same as tiles)
    const bgCtx = bgCanvas.getContext('2d');
    const bgPixelData = bgCtx.getImageData(5, 5, 1, 1).data;
    const bgColor = [bgPixelData[0], bgPixelData[1], bgPixelData[2]];
    
    for (let i = 0; i < imgData.length; i += 4) {
      const pixelR = imgData[i];
      const pixelG = imgData[i + 1];
      const pixelB = imgData[i + 2];
      
      // Check if this pixel is significantly different from background
      const dist = Math.sqrt(
        (pixelR - bgColor[0]) ** 2 +
        (pixelG - bgColor[1]) ** 2 +
        (pixelB - bgColor[2]) ** 2
      );
      
      if (imgData[i + 3] > 32 && dist > 8) { // Reduced threshold from 16 to 8
        r += pixelR;
        g += pixelG;
        b += pixelB;
        count++;
      }
    }
    if (count === 0) return [255, 255, 255];
    r = Math.round(r / count);
    g = Math.round(g / count);
    b = Math.round(b / count);
    return [r, g, b];
  }

  function createPixelExtrudedSpriteGeometry(spriteCanvas, cacheKey) {
    // Aggressive cache: only generate if not present
    if (spriteMeshCache && spriteMeshCache.has(cacheKey)) {
      return spriteMeshCache.get(cacheKey).clone();
    }
    const ctx = spriteCanvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, 256, 240).data;
    const voxels = [];
    for (let py = 0; py < 240; py++) {
      for (let px = 0; px < 256; px++) {
        const idx = (py * 256 + px) * 4;
        if (imgData[idx + 3] > 32) {
        const r = imgData[idx];
        const g = imgData[idx + 1];
        const b = imgData[idx + 2];
          const box = new THREE.BoxGeometry(1 / 16, 1 / 20, 0.5);
          box.translate((px - 128) / 16 + 1 / 32, (120 - py) / 20 + 1 / 40, 0.25);
          const material = new THREE.MeshLambertMaterial({ color: new THREE.Color(r/255, g/255, b/255) });
          const voxel = new THREE.Mesh(box, material);
          voxels.push(voxel);
        }
      }
    }
    if (voxels.length === 0) {
      return null;
    }
    const group = new THREE.Group();
    for (const v of voxels) group.add(v);
    if (spriteMeshCache) spriteMeshCache.set(cacheKey, group.clone());
    return group;
  }

  // ===== 3D BACKGROUND TILES (MERGED VOXELS + PER-TILE OVERLAY) =====
  let bgTileMeshes = [];
  let bgTileCanvases = [];
  let bgTileOverlayPlanes = [];
  let lastTileIdx = [];
  let lastTilePal = [];
  function create3DBackgroundTiles() {
    if (bgTileMeshes.length) return;
    bgTileMeshes = [];
    bgTileCanvases = [];
    bgTileOverlayPlanes = [];
    lastTileIdx = [];
    lastTilePal = [];
    for (let ty = 0; ty < 30; ty++) {
      bgTileMeshes[ty] = [];
      bgTileCanvases[ty] = [];
      bgTileOverlayPlanes[ty] = [];
      lastTileIdx[ty] = [];
      lastTilePal[ty] = [];
      for (let tx = 0; tx < 32; tx++) {
        const tileCanvas = document.createElement('canvas');
        tileCanvas.width = 8;
        tileCanvas.height = 8;
        // Create mesh for this tile
        const mesh = new THREE.Mesh();
        mesh.position.x = (tx - 31/2) * 0.5;
        mesh.position.y = (29/2 - ty) * 0.5;
        mesh.position.z = 0.5;
        mesh.visible = false;
        threeScene.add(mesh);
        bgTileMeshes[ty][tx] = mesh;
        bgTileCanvases[ty][tx] = tileCanvas;
        lastTileIdx[ty][tx] = null;
        lastTilePal[ty][tx] = null;
        // Per-tile overlay plane (created only if tile is not empty)
        bgTileOverlayPlanes[ty][tx] = null;
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

  // ===== MATERIAL CACHE FOR TILE COLORS =====
  const tileMaterialCache = new Map(); // key: avgColorHex => MeshLambertMaterial

  function getTileAverageColor(canvas, tx, ty, tileSize, nesBgColor, sampledBgColor) {
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(tx * tileSize, ty * tileSize, tileSize, tileSize).data;
    let r = 0, g = 0, b = 0, count = 0;
    for (let i = 0; i < imgData.length; i += 4) {
      const pr = imgData[i], pg = imgData[i+1], pb = imgData[i+2];
      const distNes = Math.sqrt(
        (pr - nesBgColor[0]) ** 2 +
        (pg - nesBgColor[1]) ** 2 +
        (pb - nesBgColor[2]) ** 2
      );
      const distSampled = Math.sqrt(
        (pr - sampledBgColor[0]) ** 2 +
        (pg - sampledBgColor[1]) ** 2 +
        (pb - sampledBgColor[2]) ** 2
      );
      if (distNes >= 8 && distSampled >= 8) {
        r += pr; g += pg; b += pb; count++;
    }
    }
    if (count === 0) return [255, 255, 255];
    return [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
  }

  // === Helper: get background color by sampling pixel (4,4) ===
  function getBackgroundColor(canvas) {
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(4, 4, 1, 1).data;
    const r = imgData[0];
    const g = imgData[1];
    const b = imgData[2];
    return [r, g, b];
  }

  // === Helper: get background color directly from NES RAM ===
  function getBackgroundColorFromRAM() {
    if (!nes || !nes.ppu || !nes.ppu.vramMem || typeof fbxPalette === 'undefined') {
      return [0, 0, 0];
    }
    
    // Get universal background color from palette $3F00
    const bgColorIdx = nes.ppu.vramMem[0x3F00] || 0;
    const nesColor = fbxPalette[bgColorIdx % 64] || [0, 0, 0];
    
    return nesColor;
  }

  // === Helper: check if a tile is mostly background color (85%+) ===
  function isTileMostlyBackground(canvas, tx, ty, tileSize, bgColor) {
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(tx * tileSize, ty * tileSize, tileSize, tileSize).data;
    let bgCount = 0, total = imgData.length / 4;
    
    for (let i = 0; i < imgData.length; i += 4) {
      const r = imgData[i];
      const g = imgData[i + 1];
      const b = imgData[i + 2];
      
      // Check if this pixel is close to background color (within 16 units)
      const dist = Math.sqrt(
        (r - bgColor[0]) ** 2 +
        (g - bgColor[1]) ** 2 +
        (b - bgColor[2]) ** 2
      );
      
      if (dist <= 16) bgCount++;
    }
    
    return (bgCount / total) > 0.85; // 85% threshold instead of 98%
  }

  // === Helper: check if a tile is mostly black (85%+) ===
  function isTileMostlyBlack(canvas, tx, ty, tileSize) {
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(tx * tileSize, ty * tileSize, tileSize, tileSize).data;
    let blackCount = 0, total = imgData.length / 4;
    for (let i = 0; i < imgData.length; i += 4) {
      if (imgData[i] < 16 && imgData[i + 1] < 16 && imgData[i + 2] < 16) blackCount++;
    }
    return (blackCount / total) > 0.85; // Reduced from 0.98 to 0.85
  }

  // === Helper: check if the whole scene is mostly background or black ===
  function isSceneMostlyBackground(canvas) {
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const imgData = ctx.getImageData(0, 0, width, height).data;
    
    // First try to detect background color
    const bgColor = getBackgroundColor(canvas);
    
    let bgCount = 0, blackCount = 0, total = imgData.length / 4;
    
    for (let i = 0; i < imgData.length; i += 4) {
      const r = imgData[i];
      const g = imgData[i + 1];
      const b = imgData[i + 2];
      
      // Check if this pixel is close to background color
      const dist = Math.sqrt(
        (r - bgColor[0]) ** 2 +
        (g - bgColor[1]) ** 2 +
        (b - bgColor[2]) ** 2
      );
      
      if (dist <= 16) {
        bgCount++;
      } else if (r < 16 && g < 16 && b < 16) {
        blackCount++;
      }
    }
    
    // Return true if either background or black pixels dominate
    return (bgCount / total) > 0.85 || (blackCount / total) > 0.85;
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

  // Removed unused sprite mesh variables - no longer needed with individual sprite meshes

  // ===== FAST MERGED SPRITES =====
  // Removed createSpritePlanes function - no longer needed since we use individual sprite meshes

  // ===== SPRITE OVERLAY PLANE (2D FLAT SPRITES) =====
  // Removed sprite overlay plane variables and functions - no longer needed

  function create3DSpriteMeshes() {
    if (!threeScene) return;
    // Remove old sprite meshes if any
    if (window.sprite3DMeshes) {
      for (const mesh of window.sprite3DMeshes) {
        threeScene.remove(mesh);
      }
    }
    window.sprite3DMeshes = [];
    if (!nes || !nes.ppu) return;
    const ppu = nes.ppu;
    const spriteSize = ppu.f_spriteSize ? 16 : 8;
    
    // Get NES background color for proper filtering
    let nesBgColor = [0, 0, 0];
    if (nes && nes.ppu && nes.ppu.vramMem && typeof fbxPalette !== 'undefined') {
      const bgColorIdx = nes.ppu.vramMem[0x3F00] || 0;
      nesBgColor = fbxPalette[bgColorIdx % 64] || [0, 0, 0];
    }
    
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
      
      // Skip sprites that are off-screen or have no visible pixels
      if (sx >= 256 || sy >= 240 || sx + spriteSize < 0 || sy + spriteSize < 0) continue;
      
      // Create a canvas for this sprite
      const spriteCanvas = document.createElement('canvas');
      spriteCanvas.width = spriteSize;
      spriteCanvas.height = spriteSize;
      const spriteCtx = spriteCanvas.getContext('2d');
      spriteCtx.clearRect(0, 0, spriteSize, spriteSize);
      
      // Draw the sprite pixel data onto the canvas
      if (spriteSize === 8) {
        render8x8SpriteToCanvas(spriteCtx, tileIdx, palIdx, flipH, flipV, ppu);
      } else {
        render8x16SpriteToCanvas(spriteCtx, tileIdx, palIdx, flipH, flipV, ppu);
      }
      
      // Check if sprite has any visible pixels (not just background)
      const spriteImgData = spriteCtx.getImageData(0, 0, spriteSize, spriteSize);
      let hasVisiblePixels = false;
      for (let j = 0; j < spriteImgData.data.length; j += 4) {
        const r = spriteImgData.data[j];
        const g = spriteImgData.data[j + 1];
        const b = spriteImgData.data[j + 2];
        const a = spriteImgData.data[j + 3];
        
        if (a > 0) {
          // Check if this pixel is significantly different from background
          const dist = Math.sqrt(
            (r - nesBgColor[0]) ** 2 +
            (g - nesBgColor[1]) ** 2 +
            (b - nesBgColor[2]) ** 2
          );
          if (dist > 8) {
            hasVisiblePixels = true;
            break;
          }
        }
      }
      
      if (!hasVisiblePixels) continue;
      
      // Compute average color for the sprite (excluding background)
      let r = 0, g = 0, b = 0, count = 0;
      for (let j = 0; j < spriteImgData.data.length; j += 4) {
        const pixelR = spriteImgData.data[j];
        const pixelG = spriteImgData.data[j + 1];
        const pixelB = spriteImgData.data[j + 2];
        const pixelA = spriteImgData.data[j + 3];
        
        if (pixelA > 0) {
          const dist = Math.sqrt(
            (pixelR - nesBgColor[0]) ** 2 +
            (pixelG - nesBgColor[1]) ** 2 +
            (pixelB - nesBgColor[2]) ** 2
          );
          if (dist > 8) {
            r += pixelR;
            g += pixelG;
            b += pixelB;
            count++;
          }
        }
      }
      
      if (count === 0) continue;
      
      const avgColor = [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
      const avgColorHex = (avgColor[0] << 16) | (avgColor[1] << 8) | avgColor[2];
      
      // Get or create material
      let mat = tileMaterialCache.get(avgColorHex);
      if (!mat) {
        mat = new THREE.MeshLambertMaterial({ color: avgColorHex });
        tileMaterialCache.set(avgColorHex, mat);
      }
      
      // Create per-pixel voxel extrusion for sprite depth (similar to tiles)
      const geometries = [];
      let hasVoxel = false;
      
      for (let py = 0; py < spriteSize; py++) {
        for (let px = 0; px < spriteSize; px++) {
          const idx = (py * spriteSize + px) * 4;
          const r = spriteImgData.data[idx];
          const g = spriteImgData.data[idx + 1];
          const b = spriteImgData.data[idx + 2];
          const a = spriteImgData.data[idx + 3];
          
          if (a > 0) {
            const dist = Math.sqrt(
              (r - nesBgColor[0]) ** 2 +
              (g - nesBgColor[1]) ** 2 +
              (b - nesBgColor[2]) ** 2
            );
            
            if (dist > 8) {
              // Create voxel for this pixel
              const voxelSize = 1 / 16; // Scale to NES coordinate system
              const box = new THREE.BoxGeometry(voxelSize, voxelSize, 0.3); // Reduced depth from 0.8 to 0.3
              box.translate(
                (px - spriteSize/2) * voxelSize + voxelSize/2,
                (spriteSize/2 - py) * voxelSize + voxelSize/2,
                0.15 // Reduced from 0.4 to 0.15 to center the voxel
              );
              geometries.push(box);
              hasVoxel = true;
            }
          }
        }
      }
      
      if (!hasVoxel) continue;
      
      // Merge all voxels into a single geometry
      const mergedGeometry = THREE.BufferGeometryUtils.mergeBufferGeometries(geometries);
      const mesh = new THREE.Mesh(mergedGeometry, mat);
      
      // Position sprite correctly in 3D space - much higher on Z-axis
      mesh.position.x = (sx - 128 + spriteSize / 2) / 16;
      mesh.position.y = (120 - sy - spriteSize / 2) / 15;
      mesh.position.z = priority === 1 ? 3.0 : 3.5; // Much higher Z position to be above everything
      
      // Create overlay plane for detailed sprite texture
      const overlayTexture = new THREE.CanvasTexture(spriteCanvas);
      overlayTexture.minFilter = THREE.NearestFilter;
      overlayTexture.magFilter = THREE.NearestFilter;
      
      const overlayMat = new THREE.MeshBasicMaterial({ 
        map: overlayTexture, 
        transparent: true,
        alphaTest: 0.1
      });
      
      const overlayPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(spriteSize / 16, spriteSize / 15), 
        overlayMat
      );
      overlayPlane.position.z = 0.31; // Slightly in front of the voxel geometry to ensure it's visible
      mesh.add(overlayPlane);
      
      threeScene.add(mesh);
      window.sprite3DMeshes.push(mesh);
    }
  }
  
  // Helper functions to draw sprite pixel data to a canvas
  function render8x8SpriteToCanvas(ctx, tileIdx, palIdx, flipH, flipV, ppu) {
    const ptBase = ppu.f_spPatternTable ? 0x1000 : 0x0000;
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
        const drawX = flipH ? (7 - col) : col;
        const drawY = flipV ? (7 - row) : row;
        ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
        ctx.fillRect(drawX, drawY, 1, 1);
      }
    }
  }
  function render8x16SpriteToCanvas(ctx, tileIdx, palIdx, flipH, flipV, ppu) {
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
          const drawX = flipH ? (7 - col) : col;
          const drawY = flipV ? (15 - (row + part * 8)) : (row + part * 8);
          ctx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
          ctx.fillRect(drawX, drawY, 1, 1);
        }
      }
    }
  }
  // ===== 3D SCENE UPDATE (TILES + OVERLAY) =====
  function updateThreeScene() {
    if (!use3D || !threeScene) return;
    // Get NES background color for the frame
    let bgColor = [0, 0, 0];
    if (nes && nes.ppu && nes.ppu.vramMem && typeof fbxPalette !== 'undefined') {
      const bgColorIdx = nes.ppu.vramMem[0x3F00] || 0;
      const nesColor = fbxPalette[bgColorIdx % 64] || [0, 0, 0];
      bgColor = nesColor;
    }
    // Set Three.js scene background to NES background color
    const bgColorHex = (bgColor[0] << 16) | (bgColor[1] << 8) | bgColor[2];
    threeScene.background = new THREE.Color(bgColorHex);
    update3DBackgroundTiles();
    create3DSpriteMeshes();
    // Removed updateSpriteOverlayPlane() call since we now have individual sprite meshes
    threeRenderer.render(threeScene, threeCamera);
  }

  // ===== TILE DIRTY HASHES FOR OPTIMIZATION =====
  let tileDirtyHashes = [];
  function getTileHash(tileCanvas) {
    // Simple hash: sum of all pixel values
    const ctx = tileCanvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, 8, 8).data;
    let hash = 0;
    for (let i = 0; i < imgData.length; i += 8) {
      hash = ((hash << 5) - hash + imgData[i]) | 0;
    }
    return hash;
  }

  function update3DBackgroundTiles() {
    if (!bgTileMeshes.length) return;
    let nesBgColor = [0, 0, 0];
    if (nes && nes.ppu && nes.ppu.vramMem && typeof fbxPalette !== 'undefined') {
      const bgColorIdx = nes.ppu.vramMem[0x3F00] || 0;
      nesBgColor = fbxPalette[bgColorIdx % 64] || [0, 0, 0];
    }
    const sampled = bgCanvas.getContext('2d').getImageData(4, 4, 1, 1).data;
    const sampledBgColor = [sampled[0], sampled[1], sampled[2]];
    let ppu = nes && nes.ppu;
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
        // Always clear the tile canvas before drawing
        const tileCanvas = bgTileCanvases[ty][tx];
        const tileCtx = tileCanvas.getContext('2d');
        tileCtx.clearRect(0, 0, 8, 8);
        tileCtx.drawImage(bgCanvas, tx * 8, ty * 8, 8, 8, 0, 0, 8, 8);
        // Filter out background color for overlay transparency using both NES RAM and (4,4) sampled color
        const imgData = tileCtx.getImageData(0, 0, 8, 8);
        let hasVisiblePixel = false;
        for (let i = 0; i < imgData.data.length; i += 4) {
          const r = imgData.data[i];
          const g = imgData.data[i + 1];
          const b = imgData.data[i + 2];
          const distNes = Math.sqrt(
            (r - nesBgColor[0]) ** 2 +
            (g - nesBgColor[1]) ** 2 +
            (b - nesBgColor[2]) ** 2
          );
          const distSampled = Math.sqrt(
            (r - sampledBgColor[0]) ** 2 +
            (g - sampledBgColor[1]) ** 2 +
            (b - sampledBgColor[2]) ** 2
          );
          if (distNes < 8 || distSampled < 8) {
            imgData.data[i + 3] = 0;
          } else {
            hasVisiblePixel = true;
          }
        }
        // If no visible pixel, clear the canvas to transparent
        if (!hasVisiblePixel) {
          tileCtx.clearRect(0, 0, 8, 8);
        } else {
          tileCtx.putImageData(imgData, 0, 0);
        }
        // Dirty check: only update overlay/mesh if tile hash changed
        if (!tileDirtyHashes[ty]) tileDirtyHashes[ty] = [];
        const newHash = getTileHash(tileCanvas);
        if (tileDirtyHashes[ty][tx] !== newHash || tileChanged) {
          tileDirtyHashes[ty][tx] = newHash;
          // Compute per-pixel silhouette extrusion for this tile
          const mesh = bgTileMeshes[ty][tx];
          // Use cache key based on tileIdx, palIdx, and background color
          const bgCtx = bgCanvas.getContext('2d');
          const bgPixelData = bgCtx.getImageData(5, 5, 1, 1).data;
          const bgColorKey = `${bgPixelData[0]}_${bgPixelData[1]}_${bgPixelData[2]}`;
          const cacheKey = `${tileIdx}_${palIdx}_${bgColorKey}`;
          let geometry = tileMeshCache.get(cacheKey);
          if (!geometry || tileChanged) {
            // Use background-filtered average color
            const avgColor = getTileAverageColor(bgCanvas, tx, ty, 8, nesBgColor, sampledBgColor);
            geometry = createPixelExtrudedTileGeometry(tileCanvas, avgColor, cacheKey);
            tileMeshCache.set(cacheKey, geometry);
          }
          if (geometry) {
            mesh.visible = true;
            if (mesh.geometry !== geometry) {
              if (mesh.geometry) mesh.geometry.dispose();
              mesh.geometry = geometry;
              // Assign a single material with the average color for merged geometry, using material cache
              const avgColor = getTileAverageColor(bgCanvas, tx, ty, 8, nesBgColor, sampledBgColor);
              const avgColorHex = (avgColor[0] << 16) | (avgColor[1] << 8) | avgColor[2];
              let mat = tileMaterialCache.get(avgColorHex);
              if (!mat) {
                mat = new THREE.MeshLambertMaterial({ color: avgColorHex });
                tileMaterialCache.set(avgColorHex, mat);
              }
              if (mesh.material && mesh.material !== mat) mesh.material.dispose();
              mesh.material = mat;
            }
            // Per-tile overlay plane (reuse texture if possible)
            if (!bgTileOverlayPlanes[ty][tx]) {
              const overlayTexture = new THREE.CanvasTexture(bgTileCanvases[ty][tx]);
              overlayTexture.minFilter = THREE.NearestFilter;
              overlayTexture.magFilter = THREE.NearestFilter;
              const overlayMat = new THREE.MeshBasicMaterial({ map: overlayTexture, transparent: true });
              const overlayPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), overlayMat);
              overlayPlane.position.z = 1.01;
              mesh.add(overlayPlane);
              bgTileOverlayPlanes[ty][tx] = { plane: overlayPlane, texture: overlayTexture };
            }
            // Always update overlay texture
            if (bgTileOverlayPlanes[ty][tx]) {
              bgTileOverlayPlanes[ty][tx].texture.needsUpdate = true;
            }
          } else {
            mesh.visible = false;
            // Remove overlay plane if present
            if (bgTileOverlayPlanes[ty][tx]) {
              mesh.remove(bgTileOverlayPlanes[ty][tx].plane);
              if (bgTileOverlayPlanes[ty][tx].texture) bgTileOverlayPlanes[ty][tx].texture.dispose();
              bgTileOverlayPlanes[ty][tx] = null;
            }
            // Ensure overlay is not left as gray: clear tile canvas to transparent
            tileCtx.clearRect(0, 0, 8, 8);
          }
        }
      }
    }
  }

  // Helper function to generate a simple hash for canvas data
  function generateCanvasHash(imgData) {
    let hash = 0;
    for (let i = 0; i < imgData.length; i += 16) { // Sample every 4th pixel
      hash = ((hash << 5) - hash + imgData[i]) | 0;
    }
    return hash.toString();
  }

  // ===== MAIN RENDER LOOP =====
  function renderFrame(now) {
    if (now - lastRenderTime < FRAME_TIME || now - lastFrameTime < FRAME_THROTTLE) {
      requestAnimationFrame(renderFrame);
      return;
    }
    lastRenderTime = now;
    lastFrameTime = now;
    
    if (nesFrameChanged) {
      drawLayeredCanvases(); // 2D canvas drawing
      if (use3D && !isInVR) {
        updateThreeScene(); // 3D from canvas pixels (only when not in VR)
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
    
    // Clear with NES universal background color
    const data = bgImageData.data;
    let nesBgColor = [0, 0, 0]; // Default black
    
    // Get NES universal background color (palette $3F00)
    if (ppu.vramMem && typeof fbxPalette !== 'undefined') {
      const bgColorIdx = ppu.vramMem[0x3F00] || 0;
      const nesColor = fbxPalette[bgColorIdx % 64] || [0, 0, 0];
      nesBgColor = nesColor;
    }
    
    for (let i = 0; i < data.length; i += 4) {
      data[i] = nesBgColor[0];     // R
      data[i + 1] = nesBgColor[1]; // G
      data[i + 2] = nesBgColor[2]; // B
      data[i + 3] = 255;           // A - opaque
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
            
            // Render all pixels normally (no transparency filtering)
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

  // === Tile prominence analysis function ===
  function getTileProminenceMap(canvas, tileSize = 8) {
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const imgData = ctx.getImageData(0, 0, width, height).data;

    // 1. Use NES universal background color
    let bgColor = [0, 0, 0]; // Default black
    if (nes && nes.ppu && nes.ppu.vramMem && typeof fbxPalette !== 'undefined') {
      const bgColorIdx = nes.ppu.vramMem[0x3F00] || 0;
      const nesColor = fbxPalette[bgColorIdx % 64] || [0, 0, 0];
      bgColor = nesColor;
    }

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
    };
    reader.readAsBinaryString(file);
  });

  // ===== AUDIO SETUP =====
  let nesAudioPlayer = null;
  let isMuted = false;

  // Fallback audio using onAudioSample if WebAudioPlayer is not available
  let audioCtx = null;
  let audioBufferL = [];
  let audioBufferR = [];
  const BUFFER_SIZE = 4096;
  function fallbackOnAudioSample(left, right) {
    audioBufferL.push(left);
    audioBufferR.push(right);
    if (audioBufferL.length >= BUFFER_SIZE) {
      playFallbackAudioBuffer();
      audioBufferL = [];
      audioBufferR = [];
    }
  }
  function playFallbackAudioBuffer() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      console.log('Created fallback AudioContext');
    }
    if (isMuted) return;
    const buffer = audioCtx.createBuffer(2, BUFFER_SIZE, audioCtx.sampleRate);
    // Convert samples to Float32 in [-1, 1]
    for (let i = 0; i < BUFFER_SIZE; i++) {
      buffer.getChannelData(0)[i] = audioBufferL[i] || 0;
      buffer.getChannelData(1)[i] = audioBufferR[i] || 0;
    }
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    source.start();
    console.log('Played fallback audio buffer');
  }

  // Debug: Log audio player creation and context state
  function debugAudioState(prefix = '') {
    if (nesAudioPlayer && nesAudioPlayer.ctx) {
      console.log(prefix + 'nesAudioPlayer.ctx.state:', nesAudioPlayer.ctx.state);
    } else {
      console.warn(prefix + 'nesAudioPlayer or its context is missing');
    }
  }

  // ===== MUTE BUTTON FUNCTIONALITY =====
  document.getElementById('muteBtn').addEventListener('click', function() {
    isMuted = !isMuted;
    const muteBtn = document.getElementById('muteBtn');
    console.log('Mute toggled. isMuted:', isMuted);
    if (isMuted) {
      muteBtn.textContent = '🔇';
      muteBtn.title = 'Unmute';
      // Mute the audio context
      if (nesAudioPlayer && nesAudioPlayer.ctx) {
        nesAudioPlayer.ctx.suspend();
        debugAudioState('After mute: ');
      }
    } else {
      muteBtn.textContent = '🔊';
      muteBtn.title = 'Mute';
      // Unmute the audio context
      if (nesAudioPlayer && nesAudioPlayer.ctx) {
        nesAudioPlayer.ctx.resume().then(() => debugAudioState('After unmute: '));
      }
    }
  });

  // ===== KEYBOARD CONTROLS =====
  let isPaused = false;

  // Simple keyboard handler like the working demo
  function keyboard(callback, event) {
    var player = 1;
    switch(event.keyCode) {
      case 38: // UP
        callback(player, jsnes.Controller.BUTTON_UP); break;
      case 40: // Down
        callback(player, jsnes.Controller.BUTTON_DOWN); break;
      case 37: // Left
        callback(player, jsnes.Controller.BUTTON_LEFT); break;
      case 39: // Right
        callback(player, jsnes.Controller.BUTTON_RIGHT); break;
      case 65: // 'a' - qwerty, dvorak (mirror Z)
      case 90: // 'z' - qwerty (A button)
      case 32: // Spacebar (mirror Z/A)
        callback(player, jsnes.Controller.BUTTON_A); break;
      case 83: // 's' - qwerty, azerty (mirror X)
      case 88: // 'x' - alternative B button
        callback(player, jsnes.Controller.BUTTON_B); break;
      case 9: // Tab
        callback(player, jsnes.Controller.BUTTON_SELECT); break;
      case 13: // Return
        callback(player, jsnes.Controller.BUTTON_START); break;
      default: break;
    }
  }

  // Setup keyboard controls immediately
  try {
    console.log('About to setup keyboard controls...');
    console.log('Document ready state:', document.readyState);
    console.log('Document body exists:', !!document.body);
    
    // Test if keyboard events work at all
    document.addEventListener('keydown', function(e) {
      console.log('TEST: Keydown detected:', e.keyCode, e);
    });
    
    // Use the simple approach from the working demo
    document.addEventListener('keydown', (event) => {
      console.log('Keydown event, keyCode:', event.keyCode, event);
      if (nes && typeof nes.buttonDown === 'function') {
        console.log('Calling nes.buttonDown for keyCode:', event.keyCode);
        keyboard(nes.buttonDown, event);
      }
    });
    
    document.addEventListener('keyup', (event) => {
      console.log('Keyup event, keyCode:', event.keyCode, event);
      if (nes && typeof nes.buttonUp === 'function') {
        console.log('Calling nes.buttonUp for keyCode:', event.keyCode);
        keyboard(nes.buttonUp, event);
      }
    });
    
    console.log('Keyboard controls setup complete');
  } catch (error) {
    console.error('Error setting up keyboard controls:', error);
  }

  // ===== BACKGROUND COLOR UPDATE TIMER =====
  let bgPanelColorTimer = null;
  let bgPanelColorInterval = null;
  let tileRefreshTimer = null;
  // Background panel removed - no longer needed

  // === NES START LOGIC REFACTOR ===
  function startNesEmulator() {
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
      debugAudioState('After creation: ');
    }
    // Resume audio context on user gesture (required by browsers)
    if (nesAudioPlayer && nesAudioPlayer.ctx && nesAudioPlayer.ctx.state !== 'running') {
      nesAudioPlayer.ctx.resume().then(() => {
        debugAudioState('After resume attempt: ');
        if (nesAudioPlayer.ctx.state !== 'running') {
          console.warn('Audio context is NOT running after resume!');
        }
      });
    }

    // Reset tile caches and mesh visibility
    if (typeof bgTileMeshes !== 'undefined') {
      for (let ty = 0; ty < bgTileMeshes.length; ty++) {
        if (bgTileMeshes[ty]) {
          for (let tx = 0; tx < bgTileMeshes[ty].length; tx++) {
            if (bgTileMeshes[ty][tx]) {
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

    // ===== NES INSTANTIATION =====
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
        tileMeshCache.clear();
      },
      audio: nesAudioPlayer,
      onAudioSample: (!nesAudioPlayer ? function(left, right) {
        fallbackOnAudioSample(left, right);
        if (Math.random() < 0.001) console.log('onAudioSample called:', left, right);
      } : null)
    });
    window.nes = nes;
    // Try Uint8Array first (if supported), else fallback to binary string
    try {
      if (romData instanceof Uint8Array) {
        nes.loadROM(romData);
      } else if (typeof romData === 'string') {
        nes.loadROM(romData);
      } else {
        // Try to convert to Uint8Array if possible
        nes.loadROM(new Uint8Array(romData));
      }
    } catch (e) {
      console.error('Failed to load ROM into jsnes:', e);
    }

    // Frame loop
    let lastTime = 0;
    function frameLoop(now) {
      if (!isPaused) {
        if (!lastTime || now - lastTime >= 1000 / 60) {
          nes.frame();
          lastTime = now;
        }
      }
      animationId = requestAnimationFrame(frameLoop);
    }
    requestAnimationFrame(frameLoop);
    renderFrame(0);
    // Tile refresh timer as before...
    if (tileRefreshTimer) clearTimeout(tileRefreshTimer);
    tileRefreshTimer = setTimeout(() => {
      tileMeshCache.clear();
      tileMaterialCache.clear();
      if (typeof lastTileIdx !== 'undefined') {
        for (let ty = 0; ty < lastTileIdx.length; ty++) {
          if (lastTileIdx[ty]) {
            for (let tx = 0; tx < lastTileIdx[ty].length; tx++) {
              lastTileIdx[ty][tx] = null;
              lastTilePal[ty][tx] = null;
              if (bgTileOverlayPlanes[ty] && bgTileOverlayPlanes[ty][tx] && bgTileOverlayPlanes[ty][tx].texture) {
                bgTileOverlayPlanes[ty][tx].texture.needsUpdate = true;
              }
              if (tileDirtyHashes[ty]) tileDirtyHashes[ty][tx] = null;
            }
          }
        }
      }
    }, 2000);
  }

  document.getElementById('startBtn').onclick = startNesEmulator;

  // ===== TOGGLE BUTTON BEHAVIOR =====
  // Removed toggle 3D button behavior

  // ===== AUTO-SETUP THREE.JS =====
  // Setup Three.js automatically since 3D is always active
  setupThreeJS();

  // Handle window resize for full-screen rendering
  window.addEventListener('resize', () => {
    if (threeRenderer && threeCamera) {
      threeRenderer.setSize(window.innerWidth, window.innerHeight);
      threeCamera.aspect = window.innerWidth / window.innerHeight;
      threeCamera.updateProjectionMatrix();
    }
  });

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

  // Helper: Convert ArrayBuffer to binary string (for jsnes)
  function arrayBufferToBinaryString(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return binary;
  }

});