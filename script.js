(async () => {
  const romInput = document.getElementById('romfile');
  const startBtn = document.getElementById('startBtn');
  const toggle3dBtn = document.getElementById('toggle3dBtn');
  const nesCanvas = document.getElementById('nes-canvas');
  const threejsCanvas = document.getElementById('threejs-canvas');
  const ctx = nesCanvas.getContext('2d');
  const imageData = ctx.getImageData(0, 0, 256, 240);
  const framebufferU8 = new Uint8ClampedArray(imageData.data.buffer);

  // 3D setup
  let renderer, scene, camera, nesTexture, shaderMaterial;
  let is3D = false;
  const NES_W = 256, NES_H = 240;
  const TILE_SIZE = 8;
  const GRID_W = NES_W / TILE_SIZE; // 32 tiles wide
  const GRID_H = NES_H / TILE_SIZE; // 30 tiles tall
  
  // Mouse controls
  let mouseX = 0, mouseY = 0;
  let targetRotationX = -Math.PI / 6;
  let targetRotationY = 0;
  let currentRotationX = targetRotationX;
  let currentRotationY = targetRotationY;
  let isMouseDown = false;
  let lastMouseX = 0, lastMouseY = 0;
  
  // 3D scene objects
  let backgroundGroup, spriteGroup;
  let chrTextureAtlas;
  let nes = null;
  let romDataBuffer = null;
  let romChrData = null;
  let romPrgData = null;

  // NES 64-color palette (NTSC RGB)
  const NES_PALETTE = [
    0x7C7C7C,0x0000FC,0x0000BC,0x4428BC,0x940084,0xA80020,0xA81000,0x881400,
    0x503000,0x007800,0x006800,0x005800,0x004058,0x000000,0x000000,0x000000,
    0xBCBCBC,0x0078F8,0x0058F8,0x6844FC,0xD800CC,0xE40058,0xF83800,0xE45C10,
    0xAC7C00,0x00B800,0x00A800,0x00A844,0x008888,0x000000,0x000000,0x000000,
    0xF8F8F8,0x3CBCFC,0x6888FC,0x9878F8,0xF878F8,0xF85898,0xF87858,0xFCA044,
    0xF8B800,0xB8F818,0x58D854,0x58F898,0x00E8D8,0x787878,0x000000,0x000000,
    0xFCFCFC,0xA4E4FC,0xB8B8F8,0xD8B8F8,0xF8B8F8,0xF8A4C0,0xF0D0B0,0xFCE0A8,
    0xF8D878,0xD8F878,0xB8F8B8,0xB8F8D8,0x00FCFC,0xF8D8F8,0x000000,0x000000
  ];

  function setup3D() {
    if (renderer) return;
    
    console.log('Setting up 3D scene...');
    
    renderer = new THREE.WebGLRenderer({ canvas: threejsCanvas, antialias: false });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x111111);
    
    scene = new THREE.Scene();
    
    // Perspective camera positioned to see the scene
    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, -50, 400); // Position camera to see depth effect
    camera.lookAt(0, 0, 0);
    
    // Create groups for background tiles and sprites
    backgroundGroup = new THREE.Group();
    spriteGroup = new THREE.Group();
    scene.add(backgroundGroup);
    scene.add(spriteGroup);
    
    // Add basic lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);
    
    console.log('3D scene setup complete');
  }

  function generateCHRPatternAtlas() {
    if (!romChrData) return null;
    const atlasSize = 512; // 32x16 tiles to include both pattern tables
    const canvas = document.createElement('canvas');
    canvas.width = atlasSize;
    canvas.height = atlasSize;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(atlasSize, atlasSize);
    
    // Check which pattern table the game is using
    const bgPatternTable = nes?.ppu?.f_bgPatternTable || 0;
    console.log('Background pattern table:', bgPatternTable ? '0x1000' : '0x0000');
    
    // Store pattern index (0-3) in R channel, G/B/A unused
    // Generate both pattern tables (0x0000-0x0FFF and 0x1000-0x1FFF)
    for (let tileY = 0; tileY < 32; tileY++) {
      for (let tileX = 0; tileX < 16; tileX++) {
        const tileIndex = tileY * 16 + tileX;
        const tileOffset = tileIndex * 16;
        const lowPlane = [];
        const highPlane = [];
        for (let i = 0; i < 8; i++) {
          lowPlane[i] = romChrData[tileOffset + i] || 0;
        }
        for (let i = 0; i < 8; i++) {
          highPlane[i] = romChrData[tileOffset + 8 + i] || 0;
        }
        for (let y = 0; y < 8; y++) {
          for (let x = 0; x < 8; x++) {
            const atlasX = tileX * 8 + x;
            const atlasY = tileY * 8 + y;
            const pixelIndex = (atlasY * atlasSize + atlasX) * 4;
            const lowBit = (lowPlane[y] >> (7 - x)) & 1;
            const highBit = (highPlane[y] >> (7 - x)) & 1;
            const colorIndex = (highBit << 1) | lowBit;
            imageData.data[pixelIndex + 0] = colorIndex * 85; // 0, 85, 170, 255
            imageData.data[pixelIndex + 1] = 0;
            imageData.data[pixelIndex + 2] = 0;
            imageData.data[pixelIndex + 3] = 255;
          }
        }
      }
    }
    ctx.putImageData(imageData, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    return texture;
  }

  // Palette shader for NES tiles/sprites
  function makePaletteShaderMaterial(patternAtlas, paletteColors) {
    return new THREE.ShaderMaterial({
      uniforms: {
        patternAtlas: { value: patternAtlas },
        palette: { value: new Float32Array(
          paletteColors.flatMap(rgb => [
            ((rgb >> 16) & 0xFF) / 255.0,
            ((rgb >> 8) & 0xFF) / 255.0,
            (rgb & 0xFF) / 255.0
          ])
        ) }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D patternAtlas;
        uniform float palette[12];
        varying vec2 vUv;
        void main() {
          float pattern = texture2D(patternAtlas, vUv).r * 3.0 + 0.5;
          int idx = int(floor(pattern));
          vec3 color = vec3(
            palette[idx * 3 + 0],
            palette[idx * 3 + 1],
            palette[idx * 3 + 2]
          );
          gl_FragColor = vec4(color, 1.0);
        }
      `,
      transparent: true
    });
  }

  function readNametable(nes) {
    if (!nes || !nes.ppu) {
      console.log('No NES or PPU available');
      return [];
    }
    
    // Debug the nameTable structure
    console.log('nameTable structure:', nes.ppu.nameTable);
    console.log('nameTable length:', nes.ppu.nameTable?.length);
    if (nes.ppu.nameTable && nes.ppu.nameTable[0]) {
      console.log('nameTable[0] type:', typeof nes.ppu.nameTable[0]);
      console.log('nameTable[0] keys:', Object.keys(nes.ppu.nameTable[0] || {}));
    }
    
    // Try different approaches to get the nametable
    let nametable = [];
    
    // Approach 1: Try using nameTable directly
    if (nes.ppu.nameTable && nes.ppu.nameTable[0]) {
      // Check all 4 nametables to find the one with actual game data
      console.log('Checking all 4 nametables for game data...');
      for (let ntIndex = 0; ntIndex < 4; ntIndex++) {
        const nt = nes.ppu.nameTable[ntIndex];
        if (nt && typeof nt === 'object' && nt.tile) {
          // Check if this nametable has non-zero, non-36 tiles
          let hasGameData = false;
          for (let i = 0; i < 10; i++) {
            if (nt.tile[i] !== 0 && nt.tile[i] !== 36) {
              hasGameData = true;
              break;
            }
          }
          
          if (hasGameData) {
            console.log(`Using nametable ${ntIndex} with game data`);
            nametable = [];
            for (let y = 0; y < 30; y++) {
              nametable[y] = [];
              for (let x = 0; x < 32; x++) {
                const index = y * 32 + x;
                nametable[y][x] = nt.tile[index] || 0;
              }
            }
            console.log('Read from ppu.nameTable.tile:', nametable[0]?.slice(0, 10));
            return nametable;
          } else {
            console.log(`Nametable ${ntIndex} has static data:`, nt.tile.slice(0, 10));
          }
        }
      }
      
      // If no nametable has game data, use the one specified by f_nTblAddress
      const ntIndex = nes.ppu.f_nTblAddress || 0;
      const nt = nes.ppu.nameTable[ntIndex];
      if (nt && typeof nt === 'object' && nt.tile) {
        console.log('Using f_nTblAddress nametable (static data)');
        nametable = [];
        for (let y = 0; y < 30; y++) {
          nametable[y] = [];
          for (let x = 0; x < 32; x++) {
            const index = y * 32 + x;
            nametable[y][x] = nt.tile[index] || 0;
          }
        }
        console.log('Read from ppu.nameTable.tile:', nametable[0]?.slice(0, 10));
        
        // Check if nametable is changing over time
        const firstTile = nametable[0]?.[0];
        if (window.lastTileFromNameTable !== undefined && window.lastTileFromNameTable !== firstTile) {
          console.log('Nametable changed! Tile 0,0:', window.lastTileFromNameTable, '->', firstTile);
        }
        window.lastTileFromNameTable = firstTile;
        
        return nametable;
      }
    }
    
    // Approach 2: Try using ntable1 (alternative nameTable property)
    if (nes.ppu.ntable1) {
      console.log('Using ntable1 instead');
      nametable = [];
      for (let y = 0; y < 30; y++) {
        nametable[y] = [];
        for (let x = 0; x < 32; x++) {
          nametable[y][x] = nes.ppu.ntable1[y * 32 + x] || 0;
        }
      }
      console.log('Read from ppu.ntable1:', nametable[0]?.slice(0, 10));
      return nametable;
    }
    
    // Approach 2.5: Try other PPU properties that might contain nametable data
    console.log('Checking other PPU properties for nametable data...');
    console.log('ppu.buffer length:', nes.ppu.buffer?.length);
    console.log('ppu.bgbuffer length:', nes.ppu.bgbuffer?.length);
    console.log('ppu.curNt:', nes.ppu.curNt);
    console.log('ppu.ntable1 type:', typeof nes.ppu.ntable1);
    if (nes.ppu.ntable1 && typeof nes.ppu.ntable1 === 'object') {
      console.log('ntable1 keys:', Object.keys(nes.ppu.ntable1));
    }
    
    // Try to access the PPU's internal rendering buffer
    if (nes.ppu.buffer && nes.ppu.buffer.length > 0) {
      console.log('ppu.buffer first 10 values:', nes.ppu.buffer.slice(0, 10));
    }
    if (nes.ppu.bgbuffer && nes.ppu.bgbuffer.length > 0) {
      console.log('ppu.bgbuffer first 10 values:', nes.ppu.bgbuffer.slice(0, 10));
    }
    
    // Check if there's a way to get the current nametable from the PPU state
    console.log('ppu.curNt:', nes.ppu.curNt);
    console.log('ppu.f_nTblAddress:', nes.ppu.f_nTblAddress);
    console.log('ppu.vramAddress:', nes.ppu.vramAddress);
    
    // Approach 3: Fallback to VRAM but try different nametables
    console.log('Falling back to VRAM reading');
    const nameTableAddrs = [0x2000, 0x2400, 0x2800, 0x2C00];
    for (let nt = 0; nt < 4; nt++) {
      const ntAddr = nameTableAddrs[nt];
      const sampleTile = nes.ppu.vramMem[ntAddr] || 0;
      console.log(`VRAM nametable ${nt} (0x${ntAddr.toString(16)}): first tile = ${sampleTile}`);
      if (sampleTile !== 0 && sampleTile !== 36) {
        nametable = [];
        for (let y = 0; y < 30; y++) {
          nametable[y] = [];
          for (let x = 0; x < 32; x++) {
            const addr = ntAddr + y * 32 + x;
            nametable[y][x] = nes.ppu.vramMem[addr] || 0;
          }
        }
        console.log(`Using VRAM nametable ${nt}:`, nametable[0]?.slice(0, 10));
        return nametable;
      }
    }
    
    // If all else fails, try to extract from framebuffer
    if (window.currentFramebuffer) {
      console.log('Attempting to extract nametable from framebuffer...');
      // This is a simplified approach - in reality, you'd need to decode the pattern data
      // For now, just return a test pattern to see if this approach works
      const testNametable = [];
      for (let y = 0; y < 30; y++) {
        testNametable[y] = [];
        for (let x = 0; x < 32; x++) {
          // Use a simple pattern for testing
          testNametable[y][x] = (x + y) % 256;
        }
      }
      console.log('Using test nametable from framebuffer:', testNametable[0]?.slice(0, 10));
      return testNametable;
    }
    
    // If all else fails, return empty nametable
    console.log('No valid nametable found, returning empty');
    return Array(30).fill().map(() => Array(32).fill(0));
  }

  function readAttributeTable(nes) {
    if (!nes || !nes.ppu) return [];
    
    // Try to get the same nametable that was used for the background
    let nt = null;
    let ntAddr = 0x2000; // Default
    
    // Approach 1: Try using nameTable
    if (nes.ppu.nameTable && nes.ppu.nameTable[0]) {
      const ntIndex = nes.ppu.f_nTblAddress || 0;
      const ntObj = nes.ppu.nameTable[ntIndex];
      if (ntObj && ntObj.attrib) {
        // Use the attrib property from the nametable object
        nt = ntObj.attrib;
        console.log('Using nameTable attrib data');
      }
    }
    
    // Approach 2: Try using ntable1
    if (!nt && nes.ppu.ntable1) {
      nt = nes.ppu.ntable1;
    }
    
    // Approach 3: Use VRAM with the same logic as readNametable
    if (!nt) {
      const nameTableAddrs = [0x2000, 0x2400, 0x2800, 0x2C00];
      for (let i = 0; i < 4; i++) {
        const addr = nameTableAddrs[i];
        const sampleTile = nes.ppu.vramMem[addr] || 0;
        if (sampleTile !== 0 && sampleTile !== 36) {
          ntAddr = addr;
          break;
        }
      }
    }
    
    const attributes = [];
    for (let y = 0; y < 30 / 4; y++) {
      attributes[y] = [];
      for (let x = 0; x < 32 / 4; x++) {
        if (nt) {
          // Attribute table is at offset 0x3C0 in each nametable
          const addr = 0x3C0 + y * 8 + x;
          attributes[y][x] = nt[addr] || 0;
        } else {
          // Use VRAM
          const addr = ntAddr + 0x3C0 + y * 8 + x;
          attributes[y][x] = nes.ppu.vramMem[addr] || 0;
        }
      }
    }
    return attributes;
  }

  function readOAM(nes) {
    if (!nes || !nes.ppu) return [];
    
    const sprites = [];
    
    // Try different ways to access OAM data
    let oam = null;
    if (nes.ppu.oamMem) {
      oam = nes.ppu.oamMem;
    } else if (nes.ppu.oam) {
      oam = nes.ppu.oam;
    } else if (nes.ppu.mem && nes.ppu.mem.oam) {
      oam = nes.ppu.mem.oam;
    } else {
      // If we can't access OAM, return empty sprites array
      console.log('OAM not accessible, skipping sprites');
      return [];
    }
    
    // Read OAM (Object Attribute Memory)
    for (let i = 0; i < 64; i++) {
      const baseAddr = i * 4;
      const y = oam[baseAddr] || 0;
      const tileIndex = oam[baseAddr + 1] || 0;
      const attributes = oam[baseAddr + 2] || 0;
      const x = oam[baseAddr + 3] || 0;
      
      if (y < 240) { // Valid sprite
        sprites.push({
          x: x,
          y: y,
          tileIndex: tileIndex,
          attributes: attributes,
          priority: (attributes >> 5) & 1, // 0 = behind background, 1 = in front
          flipX: (attributes >> 6) & 1,
          flipY: (attributes >> 7) & 1,
          palette: attributes & 3
        });
      }
    }
    
    return sprites;
  }

  function getPPUPaletteRAM(nes) {
    // Try common jsnes PPU palette RAM properties
    if (nes && nes.ppu) {
      if (nes.ppu.paletteTable) return nes.ppu.paletteTable;
      if (nes.ppu.palette_ram) return nes.ppu.palette_ram;
      if (nes.ppu.paletteRAM) return nes.ppu.paletteRAM;
      if (nes.ppu.mem && nes.ppu.mem.palette) return nes.ppu.mem.palette;
    }
    return null;
  }

  // Utility to fully clear a Three.js group and dispose geometries/materials
  function clearGroup(group) {
    while (group.children.length > 0) {
      const obj = group.children[0];
      group.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    }
  }

  // Advanced depth detection algorithm for NES games
  function calculatePixelDepth(rgb, pixelIndex, width, height) {
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    
    // Extract RGB components
    const r = rgb & 0xFF;
    const g = (rgb >> 8) & 0xFF;
    const b = (rgb >> 16) & 0xFF;
    
    // Calculate brightness and saturation
    const brightness = (r + g + b) / 3;
    const maxColor = Math.max(r, g, b);
    const minColor = Math.min(r, g, b);
    const saturation = maxColor === 0 ? 0 : (maxColor - minColor) / maxColor;
    
    // NES-specific color analysis
    let depth = 0;
    
    // 1. SKY/BACKGROUND DETECTION (far away)
    // NES sky is typically light blue, cyan, or white
    if ((b > r + 20 && b > g + 20) || // Blue dominant
        (r > 200 && g > 200 && b > 200) || // Very bright (white)
        (brightness > 180 && saturation < 0.3)) { // Light, low saturation
      depth = 0;
    }
    // 2. GROUND/FLOOR DETECTION (medium distance)
    // NES ground is typically brown, green, or gray
    else if ((r > g && r > b && r < 180) || // Brown tones
             (g > r && g > b && g < 160) || // Green tones
             (Math.abs(r - g) < 20 && Math.abs(g - b) < 20 && brightness < 150)) { // Gray tones
      depth = 2;
    }
    // 3. WALLS/OBSTACLES DETECTION (close)
    // NES walls are typically dark, solid colors
    else if (brightness < 120 || // Dark colors
             (saturation > 0.6 && brightness < 160)) { // Saturated dark colors
      depth = 4;
    }
    // 4. FOREGROUND OBJECTS DETECTION (very close)
    // Bright, colorful objects like coins, power-ups, etc.
    else if (brightness > 200 || // Very bright
             (saturation > 0.7 && brightness > 150)) { // Very saturated and bright
      depth = 6;
    }
    // 5. SPRITE DETECTION (closest)
    // Check for sprite-like characteristics
    else if (isLikelySprite(rgb, x, y, width, height)) {
      depth = 8;
    }
    // 6. DEFAULT (medium depth)
    else {
      depth = 3;
    }
    
    // Apply tile-based consistency (NES tiles are 8x8)
    const tileX = Math.floor(x / 8);
    const tileY = Math.floor(y / 8);
    
    // Smooth depth within tiles to avoid jagged edges
    const tileDepth = getTileDepth(tileX, tileY, width, height);
    if (tileDepth !== null) {
      // Blend individual pixel depth with tile depth
      depth = (depth * 0.7 + tileDepth * 0.3);
    }
    
    // Apply edge detection for smoother transitions
    const edgeFactor = detectEdges(x, y, width, height);
    if (edgeFactor > 0.5) {
      depth *= 0.8; // Reduce depth at edges for smoother transitions
    }
    
    return Math.max(0, Math.min(10, depth));
  }
  
  function getTileDepth(tileX, tileY, width, height) {
    // Analyze the entire 8x8 tile to determine its overall depth
    const tileSize = 8;
    const depths = [];
    
    for (let dy = 0; dy < tileSize; dy++) {
      for (let dx = 0; dx < tileSize; dx++) {
        const x = tileX * tileSize + dx;
        const y = tileY * tileSize + dy;
        if (x < width && y < height) {
          const pixelIndex = y * width + x;
          if (window.currentFramebuffer && window.currentFramebuffer[pixelIndex]) {
            const rgb = window.currentFramebuffer[pixelIndex];
            const r = rgb & 0xFF;
            const g = (rgb >> 8) & 0xFF;
            const b = (rgb >> 16) & 0xFF;
            const brightness = (r + g + b) / 3;
            depths.push(brightness);
          }
        }
      }
    }
    
    if (depths.length === 0) return null;
    
    // Calculate tile depth based on average brightness and variance
    const avgBrightness = depths.reduce((a, b) => a + b, 0) / depths.length;
    const variance = depths.reduce((sum, val) => sum + Math.pow(val - avgBrightness, 2), 0) / depths.length;
    
    // High variance indicates detailed tiles (likely foreground)
    // Low variance with high brightness indicates sky/background
    // Low variance with low brightness indicates walls/obstacles
    if (variance > 1000) return 6; // High detail
    if (avgBrightness > 180) return 0; // Sky/background
    if (avgBrightness < 100) return 4; // Walls/obstacles
    return 2; // Ground/floor
  }
  
  function detectEdges(x, y, width, height) {
    // Simple edge detection to smooth depth transitions
    const neighbors = [];
    const currentIndex = y * width + x;
    
    // Check 8 surrounding pixels
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        
        const nx = x + dx;
        const ny = y + dy;
        
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const neighborIndex = ny * width + nx;
          if (window.currentFramebuffer && window.currentFramebuffer[neighborIndex]) {
            neighbors.push(window.currentFramebuffer[neighborIndex]);
          }
        }
      }
    }
    
    if (neighbors.length === 0) return 0;
    
    // Calculate edge factor based on color differences
    const currentRgb = window.currentFramebuffer[currentIndex];
    const currentBrightness = ((currentRgb & 0xFF) + ((currentRgb >> 8) & 0xFF) + ((currentRgb >> 16) & 0xFF)) / 3;
    
    let totalDifference = 0;
    for (const neighborRgb of neighbors) {
      const neighborBrightness = ((neighborRgb & 0xFF) + ((neighborRgb >> 8) & 0xFF) + ((neighborRgb >> 16) & 0xFF)) / 3;
      totalDifference += Math.abs(currentBrightness - neighborBrightness);
    }
    
    return Math.min(1, totalDifference / (neighbors.length * 255));
  }
  
  function isLikelySprite(rgb, x, y, width, height) {
    // Advanced sprite detection for NES games
    const r = rgb & 0xFF;
    const g = (rgb >> 8) & 0xFF;
    const b = (rgb >> 16) & 0xFF;
    const brightness = (r + g + b) / 3;
    const maxColor = Math.max(r, g, b);
    const minColor = Math.min(r, g, b);
    const saturation = maxColor === 0 ? 0 : (maxColor - minColor) / maxColor;
    
    // 1. Very bright pixels (coins, power-ups, etc.)
    if (brightness > 220) {
      return true;
    }
    
    // 2. Highly saturated bright colors (character sprites, enemies)
    if (saturation > 0.6 && brightness > 150) {
      return true;
    }
    
    // 3. Check for sprite-like patterns (isolated bright pixels)
    const neighbors = [];
    let brightNeighbors = 0;
    let totalNeighbors = 0;
    
    // Check 5x5 area around pixel
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (dx === 0 && dy === 0) continue;
        
        const nx = x + dx;
        const ny = y + dy;
        
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const neighborIndex = ny * width + nx;
          if (window.currentFramebuffer && window.currentFramebuffer[neighborIndex]) {
            const neighborRgb = window.currentFramebuffer[neighborIndex];
            const nr = neighborRgb & 0xFF;
            const ng = (neighborRgb >> 8) & 0xFF;
            const nb = (neighborRgb >> 16) & 0xFF;
            const neighborBrightness = (nr + ng + nb) / 3;
            
            neighbors.push(neighborBrightness);
            if (neighborBrightness > 150) {
              brightNeighbors++;
            }
            totalNeighbors++;
          }
        }
      }
    }
    
    if (neighbors.length === 0) return false;
    
    // 4. High contrast with surroundings
    const avgNeighborBrightness = neighbors.reduce((a, b) => a + b, 0) / neighbors.length;
    if (brightness - avgNeighborBrightness > 60) {
      return true;
    }
    
    // 5. Check for sprite clusters (multiple bright pixels together)
    if (brightNeighbors >= 3 && totalNeighbors >= 8) {
      return true;
    }
    
    // 6. Check for specific NES sprite colors (red, yellow, white)
    // Mario's red, Luigi's green, coins' yellow, etc.
    if ((r > 200 && g < 100 && b < 100) || // Red
        (r > 200 && g > 200 && b < 100) || // Yellow
        (r > 200 && g > 200 && b > 200)) { // White
      return true;
    }
    
    return false;
  }
  
  function create3DGeometryFromDepthMap(depthMap, width, height, texture) {
    const geometry = new THREE.BufferGeometry();
    const vertices = [];
    const uvs = [];
    const indices = [];
    const normals = [];
    
    // Use tile-based approach for better performance and NES authenticity
    const tileSize = 8; // NES tiles are 8x8 pixels
    const tilesX = Math.floor(width / tileSize);
    const tilesY = Math.floor(height / tileSize);
    
    // Create vertices for each tile
    for (let tileY = 0; tileY <= tilesY; tileY++) {
      for (let tileX = 0; tileX <= tilesX; tileX++) {
        // Calculate average depth for this tile
        let totalDepth = 0;
        let depthCount = 0;
        
        for (let dy = 0; dy < tileSize; dy++) {
          for (let dx = 0; dx < tileSize; dx++) {
            const x = tileX * tileSize + dx;
            const y = tileY * tileSize + dy;
            if (x < width && y < height) {
              const pixelIndex = y * width + x;
              const depth = depthMap[pixelIndex] || 0;
              totalDepth += depth;
              depthCount++;
            }
          }
        }
        
        const avgDepth = depthCount > 0 ? totalDepth / depthCount : 0;
        
        // Convert tile coordinates to 3D coordinates
        const x3d = (tileX * tileSize - width / 2) * 1.5; // Scale for better visibility
        const y3d = (height / 2 - tileY * tileSize) * 1.5;
        const z3d = avgDepth * 3; // Enhanced depth scaling
        
        // Create 4 vertices for this tile (quad)
        const verticesForTile = [
          x3d, y3d, z3d,                    // Top-left
          x3d + tileSize * 1.5, y3d, z3d,  // Top-right
          x3d + tileSize * 1.5, y3d - tileSize * 1.5, z3d, // Bottom-right
          x3d, y3d - tileSize * 1.5, z3d   // Bottom-left
        ];
        
        vertices.push(...verticesForTile);
        
        // UV coordinates for texture mapping
        const u1 = tileX / tilesX;
        const v1 = tileY / tilesY;
        const u2 = (tileX + 1) / tilesX;
        const v2 = (tileY + 1) / tilesY;
        
        uvs.push(u1, v1, u2, v1, u2, v2, u1, v2);
        
        // Calculate normal for this tile
        const normal = [0, 0, 1]; // Default normal pointing forward
        normals.push(...normal, ...normal, ...normal, ...normal);
      }
    }
    
    // Create indices for all tiles
    for (let tileY = 0; tileY < tilesY; tileY++) {
      for (let tileX = 0; tileX < tilesX; tileX++) {
        const baseIndex = (tileY * (tilesX + 1) + tileX) * 4;
        
        // Create two triangles for each tile quad
        indices.push(
          baseIndex, baseIndex + 1, baseIndex + 2,     // First triangle
          baseIndex, baseIndex + 2, baseIndex + 3      // Second triangle
        );
      }
    }
    
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setIndex(indices);
    
    return geometry;
  }

  function create3DScene(nes) {
    if (!nes) return;
    if (!renderer) setup3D();
    if (backgroundGroup) clearGroup(backgroundGroup);
    if (spriteGroup) clearGroup(spriteGroup);
    
    try {
      console.log('Creating 3D scene...');
      
      // Use the framebuffer directly
      if (window.currentFramebuffer) {
        console.log('Framebuffer available, creating textured scene');
        
        // Create a simple texture from the framebuffer
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 240;
        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(256, 240);
        
        // Convert framebuffer to image data
        for (let i = 0; i < 256 * 240; i++) {
          const rgb = window.currentFramebuffer[i];
          const pixelIndex = i * 4;
          imageData.data[pixelIndex + 0] = rgb & 0xFF;         // R
          imageData.data[pixelIndex + 1] = (rgb >> 8) & 0xFF;  // G
          imageData.data[pixelIndex + 2] = (rgb >> 16) & 0xFF; // B
          imageData.data[pixelIndex + 3] = 0xFF;               // A
        }
        
        ctx.putImageData(imageData, 0, 0);
        const texture = new THREE.CanvasTexture(canvas);
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        
        // Create a simple textured plane first
        const geometry = new THREE.PlaneGeometry(256, 240);
        const material = new THREE.MeshBasicMaterial({ 
          map: texture,
          transparent: true
        });
        
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(0, 0, 0);
        backgroundGroup.add(mesh);
        
        console.log('3D scene created with simple texture');
        
        // Add some debug info
        console.log('Framebuffer length:', window.currentFramebuffer.length);
        console.log('First few framebuffer values:', window.currentFramebuffer.slice(0, 10));
      } else {
        console.log('No framebuffer available, creating fallback scene');
        // Fallback: create a simple colored plane
        const geometry = new THREE.PlaneGeometry(256, 240);
        const material = new THREE.MeshBasicMaterial({ color: 0x808080 });
        const plane = new THREE.Mesh(geometry, material);
        plane.position.set(0, 0, 0);
        backgroundGroup.add(plane);
      }
    } catch (error) {
      console.error('Error in create3DScene:', error);
      console.error('Error stack:', error.stack);
    }
  }

  function update3DScene() {
    if (nes && is3D) {
      try {
        console.log('Updating 3D scene...');
        console.log('NES object:', nes);
        console.log('PPU object:', nes.ppu);
        
        // Debug PPU memory access
        if (nes.ppu) {
          console.log('PPU properties:', Object.keys(nes.ppu));
          if (nes.ppu.vramMem) {
            console.log('VRAM size:', nes.ppu.vramMem.length);
            console.log('First few VRAM bytes:', nes.ppu.vramMem.slice(0, 10));
          }
        }
        
        create3DScene(nes);
        console.log('3D scene updated successfully');
      } catch (error) {
        console.error('Error updating 3D scene:', error);
        console.error('Error stack:', error.stack);
      }
    }
  }

  function render3D() {
    if (!renderer) setup3D();
    
    // Smooth camera rotation
    currentRotationX += (targetRotationX - currentRotationX) * 0.1;
    currentRotationY += (targetRotationY - currentRotationY) * 0.1;
    
    // Apply rotation to scene
    scene.rotation.x = currentRotationX;
    scene.rotation.y = currentRotationY;
    
    // Make sure we have something to render
    if (backgroundGroup && backgroundGroup.children.length > 0) {
      console.log('Rendering 3D scene with', backgroundGroup.children.length, 'objects');
      renderer.render(scene, camera);
    } else {
      console.log('No objects to render in 3D scene');
      // Create a fallback object if nothing is there
      const geometry = new THREE.BoxGeometry(100, 100, 100);
      const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
      const cube = new THREE.Mesh(geometry, material);
      backgroundGroup.add(cube);
      renderer.render(scene, camera);
    }
  }

  function resize3D() {
    if (!renderer || !camera) return;
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize3D);
  
  // Mouse event handlers
  threejsCanvas.addEventListener('mousedown', (event) => {
    isMouseDown = true;
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
  });
  
  threejsCanvas.addEventListener('mousemove', (event) => {
    if (!isMouseDown) return;
    
    const deltaX = event.clientX - lastMouseX;
    const deltaY = event.clientY - lastMouseY;
    
    targetRotationY += deltaX * 0.01;
    targetRotationX += deltaY * 0.01;
    
    targetRotationX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, targetRotationX));
    
    lastMouseX = event.clientX;
    lastMouseY = event.clientY;
  });
  
  threejsCanvas.addEventListener('mouseup', () => {
    isMouseDown = false;
  });
  
  threejsCanvas.addEventListener('mouseleave', () => {
    isMouseDown = false;
  });

  // 2D/3D toggle
  toggle3dBtn.addEventListener('click', () => {
    is3D = !is3D;
    console.log('Switching to', is3D ? '3D' : '2D', 'mode');
    
    if (is3D) {
      nesCanvas.style.display = 'none';
      threejsCanvas.style.display = 'block';
      threejsCanvas.style.width = '100vw';
      threejsCanvas.style.height = '100vh';
      toggle3dBtn.textContent = 'Switch to 2D';
      resize3D();
      console.log('Calling update3DScene...');
      update3DScene(); // Initialize 3D scene
      console.log('update3DScene called');
    } else {
      nesCanvas.style.display = 'block';
      threejsCanvas.style.display = 'none';
      toggle3dBtn.textContent = 'Switch to 3D';
    }
  });

  // Add a button to reset the camera
  const resetCameraBtn = document.createElement('button');
  resetCameraBtn.textContent = 'Reset Camera';
  resetCameraBtn.style.display = 'block';
  resetCameraBtn.style.marginTop = '5px';
  document.getElementById('ui').appendChild(resetCameraBtn);
  resetCameraBtn.addEventListener('click', () => {
    if (camera) {
      camera.position.set(0, -50, 400);
      camera.lookAt(0, 0, 0);
      currentRotationX = targetRotationX = -Math.PI / 6;
      currentRotationY = targetRotationY = 0;
      render3D();
    }
  });



  function arrayBufferToBase64(buffer) {
    const binary = String.fromCharCode.apply(null, new Uint8Array(buffer));
    return btoa(binary);
  }
  function arrayBufferToString(buffer) {
    return String.fromCharCode.apply(null, new Uint8Array(buffer));
  }

  function parseINesRom(buffer) {
    const data = new Uint8Array(buffer);
    if (data[0] !== 0x4E || data[1] !== 0x45 || data[2] !== 0x53 || data[3] !== 0x1A) {
      return null;
    }
    const prgSize = data[4] * 16384;
    const chrSize = data[5] * 8192;
    if (prgSize === 0) return null;
    if (data.length < 16 + prgSize) return null;
    const chrStart = 16 + prgSize;
    const chrEnd = chrStart + chrSize;
    if (chrSize > 0 && data.length < chrEnd) return null;
    const prgData = data.slice(16, 16 + prgSize);
    const chrData = chrSize > 0 ? data.slice(chrStart, chrEnd) : new Uint8Array(8192);
    return { chrData, prgData, prgSize, chrSize };
  }

  romInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    console.log('ROM file selected:', file.name, file.size, 'bytes');
    const reader = new FileReader();
    reader.onload = (event) => {
      romDataBuffer = event.target.result;
      let parsed = parseINesRom(romDataBuffer);
      console.log('ROM parsed:', parsed ? 'success' : 'fail', parsed);
      if (parsed) {
        romChrData = parsed.chrData;
        romPrgData = parsed.prgData;
        startBtn.disabled = false;
        console.log('Start Emulation button enabled');
      } else {
        startBtn.disabled = true;
        alert('Could not parse ROM file. Please ensure it\'s a valid NES ROM.');
      }
    };
    reader.onerror = (error) => {
      alert('Failed to read ROM file');
    };
    reader.readAsArrayBuffer(file);
  });

  startBtn.addEventListener('click', () => {
    if (!romDataBuffer) {
      alert('No ROM loaded');
      return;
    }
    if (typeof jsnes === 'undefined') {
      alert('jsnes library not loaded. Please check your internet connection.');
      return;
    }
    nes = new jsnes.NES({
      onFrame: onFrame,
      onAudioSample: () => {},
    });
    // Monkey-patch to expose palette and OAM
    if (nes && nes.ppu) {
      nes.ppu.paletteTable = nes.ppu.palTable;
      nes.ppu.oamMem = nes.ppu.spriteMem;
    }
    try {
      console.log('Loading ROM into NES...');
      nes.loadROM(arrayBufferToString(romDataBuffer));
      console.log('ROM loaded into NES:', !!nes.rom);
      console.log('NES ROM size:', nes.rom ? nes.rom.length : 0);
      console.log('Initial CPU PC:', nes.cpu.PC);
      console.log('Initial CPU A:', nes.cpu.A);
      startEmulation();
    } catch (err) {
      console.error('Failed to load ROM:', err);
      alert('Failed to load ROM.');
    }
  });

  function onFrame(framebuffer_24bit) {
    // framebuffer_24bit is Uint32Array (256*240), each pixel is 0x00RRGGBB
    for (let i = 0; i < 256 * 240; i++) {
      const rgb = framebuffer_24bit[i];
      framebufferU8[i * 4 + 0] = rgb & 0xFF;         // B (was R)
      framebufferU8[i * 4 + 1] = (rgb >> 8) & 0xFF;  // G
      framebufferU8[i * 4 + 2] = (rgb >> 16) & 0xFF; // R (was B)
      framebufferU8[i * 4 + 3] = 0xFF;               // A
    }
    if (!is3D) {
      ctx.putImageData(imageData, 0, 0);
    }
    
    // Store the framebuffer for potential nametable extraction
    window.currentFramebuffer = framebuffer_24bit;
    
    // Don't update 3D scene here - it will be updated in the main loop after nes.frame()
  }

  let lastTime = performance.now();
  let frameCount = 0;
  const targetFPS = 60;
  const frameInterval = 1000 / targetFPS;

  function startEmulation() {
    console.log('Starting emulation...');
    console.log('ROM loaded:', !!romDataBuffer);
    console.log('CHR data size:', romChrData ? romChrData.length : 0);
    console.log('PRG data size:', romPrgData ? romPrgData.length : 0);
    
    function loop() {
      const now = performance.now();
      const delta = now - lastTime;
      if (delta < frameInterval) {
        requestAnimationFrame(loop);
        return;
      }
      lastTime = now;
      if (nes) {
        nes.frame();
        frameCount++;
        
        // Debug: Check if CPU is running
        if (frameCount % 60 === 0) { // Log every second
          console.log('Frame:', frameCount, 'CPU PC:', nes.cpu.PC, 'CPU A:', nes.cpu.A);
          console.log('CPU running:', nes.cpu.PC !== 0);
          console.log('ROM loaded in NES:', !!nes.rom);
          
          // Check if VRAM is changing
          const vramSample = nes.ppu.vramMem.slice(0x2000, 0x2010);
          if (window.lastVramSample) {
            const changed = vramSample.some((val, i) => val !== window.lastVramSample[i]);
            if (changed) {
              console.log('VRAM changed! Sample:', vramSample);
            }
          }
          window.lastVramSample = vramSample;
        }
        
        // Update 3D scene after the emulator has rendered the frame
        if (is3D) {
          update3DScene();
          render3D();
        } else {
          // Make sure 2D canvas is visible
          nesCanvas.style.display = 'block';
          threejsCanvas.style.display = 'none';
        }
      }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }

  // Test jsnes on page load
  window.addEventListener('load', () => {
    setTimeout(() => {
      if (typeof jsnes !== 'undefined') {
        try {
          new jsnes.NES({ onFrame: () => {}, onAudioSample: () => {} });
        } catch (err) {}
      }
    }, 1000);
  });
})();