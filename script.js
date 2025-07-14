// fami3d main script (extracted from index.html <script> tag)
const canvas = document.getElementById('nes-canvas');
const ctx = canvas.getContext('2d');
const imageData = ctx.getImageData(0, 0, 256, 240);

let nes = null;
let animationId = null;
let romData = null;

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
    }
  });
  nes.loadROM(romData);
  window.nes = nes; // Expose for console inspection
  console.dir(nes);
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

const bgCanvas = document.getElementById('bg-canvas');
const bgCtx = bgCanvas.getContext('2d');
const spriteCanvas = document.getElementById('sprite-canvas');
const spriteCtx = spriteCanvas.getContext('2d');
const spriteBehindCanvas = document.getElementById('sprite-behind-canvas');
const spriteBehindCtx = spriteBehindCanvas.getContext('2d');

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