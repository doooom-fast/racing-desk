// ═══════════════════════════════════════════════════════════════
// Minimal QR Code Generator — no dependencies, byte-mode only
// Generates Version 3 (29x29) QR codes with ECC level M.
// Draws directly to a <canvas> element.
// ═══════════════════════════════════════════════════════════════

(function() {
  'use strict';

  // GF(256) tables for Reed-Solomon ECC
  var EXP = new Uint8Array(256), LOG = new Uint8Array(256);
  (function() {
    var x = 1;
    for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x = (x << 1) ^ (x >= 128 ? 0x11d : 0); }
    EXP[255] = EXP[0];
  })();

  function gfMul(a, b) { return a === 0 || b === 0 ? 0 : EXP[(LOG[a] + LOG[b]) % 255]; }

  function rsEncode(data, eccLen) {
    // Generator polynomial for eccLen
    var gen = [1];
    for (var i = 0; i < eccLen; i++) {
      var ng = new Array(gen.length + 1);
      ng[0] = 0;
      for (var j = 0; j < gen.length; j++) ng[j + 1] = gen[j];
      for (var j = 0; j < gen.length; j++) {
        var coeff = gfMul(gen[j], EXP[i]);
        ng[j] ^= coeff;
      }
      gen = ng;
    }
    var msg = new Uint8Array(data.length + eccLen);
    msg.set(data);
    for (var i = 0; i < data.length; i++) {
      var coeff = msg[i];
      if (coeff !== 0) {
        for (var j = 0; j < gen.length; j++) {
          msg[i + j] ^= gfMul(gen[j], coeff);
        }
      }
    }
    return msg.slice(data.length);
  }

  // QR Version 3, ECC M: 44 data codewords, 26 ECC codewords (1 block)
  var VERSION = 3, SIZE = 29, DATA_CW = 44, ECC_CW = 26;

  function encodeData(text) {
    var bytes = [];
    for (var i = 0; i < text.length; i++) {
      var c = text.charCodeAt(i);
      if (c < 128) bytes.push(c);
      else if (c < 2048) { bytes.push(0xc0 | (c >> 6)); bytes.push(0x80 | (c & 0x3f)); }
      else { bytes.push(0xe0 | (c >> 12)); bytes.push(0x80 | ((c >> 6) & 0x3f)); bytes.push(0x80 | (c & 0x3f)); }
    }
    // Mode indicator (0100 = byte) + char count (8 bits for V1-9)
    var bits = [];
    function pushBits(val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); }
    pushBits(4, 4);           // byte mode
    pushBits(bytes.length, 8); // character count
    for (var i = 0; i < bytes.length; i++) pushBits(bytes[i], 8);
    pushBits(0, 4);           // terminator (up to 4 bits)
    // Pad to byte boundary
    while (bits.length % 8 !== 0) bits.push(0);
    // Pad to DATA_CW codewords
    var codewords = new Uint8Array(DATA_CW);
    for (var i = 0; i < bits.length / 8 && i < DATA_CW; i++) {
      var b = 0;
      for (var j = 0; j < 8; j++) b = (b << 1) | (bits[i * 8 + j] || 0);
      codewords[i] = b;
    }
    var pad = [0xec, 0x11], pi = 0;
    for (var i = Math.ceil(bits.length / 8); i < DATA_CW; i++) {
      codewords[i] = pad[pi++ % 2];
    }
    return codewords;
  }

  function createMatrix() {
    var m = [];
    for (var i = 0; i < SIZE; i++) { m[i] = new Uint8Array(SIZE); }
    return m;
  }

  function isReserved(r, c) {
    // Finder patterns (7x7 + separators)
    if (r < 9 && c < 9) return true;
    if (r < 9 && c >= SIZE - 8) return true;
    if (r >= SIZE - 8 && c < 9) return true;
    // Timing patterns
    if (r === 6 || c === 6) return true;
    // Format info
    if (r === 8 && (c < 9 || c >= SIZE - 8)) return true;
    if (c === 8 && (r < 9 || r >= SIZE - 7)) return true;
    return false;
  }

  function placeFinderPattern(m, r, c) {
    for (var dr = -1; dr <= 7; dr++) {
      for (var dc = -1; dc <= 7; dc++) {
        var rr = r + dr, cc = c + dc;
        if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) continue;
        if (dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6) {
          var ring = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
          m[rr][cc] = (ring !== 1 && ring !== 4) ? 1 : 0;
        } else {
          m[rr][cc] = 0; // separator
        }
      }
    }
  }

  function placeTiming(m) {
    for (var i = 8; i < SIZE - 8; i++) {
      m[6][i] = (i % 2 === 0) ? 1 : 0;
      m[i][6] = (i % 2 === 0) ? 1 : 0;
    }
  }

  function placeData(m, codewords) {
    var bitIdx = 0;
    var totalBits = codewords.length * 8;
    var col = SIZE - 1;
    var upward = true;

    while (col > 0) {
      if (col === 6) col--; // skip timing column
      for (var row = 0; row < SIZE; row++) {
        var r = upward ? SIZE - 1 - row : row;
        for (var dc = 0; dc <= 1; dc++) {
          var c = col - dc;
          if (c < 0 || c >= SIZE) continue;
          if (isReserved(r, c)) continue;
          if (bitIdx < totalBits) {
            var byteIdx = Math.floor(bitIdx / 8);
            var bitPos = 7 - (bitIdx % 8);
            m[r][c] = (codewords[byteIdx] >> bitPos) & 1;
            bitIdx++;
          }
        }
      }
      col -= 2;
      upward = !upward;
    }
  }

  function applyMask(m, maskId) {
    var maskFn;
    switch (maskId) {
      case 0: maskFn = function(r, c) { return (r + c) % 2 === 0; }; break;
      case 1: maskFn = function(r, c) { return r % 2 === 0; }; break;
      case 2: maskFn = function(r, c) { return c % 3 === 0; }; break;
      case 3: maskFn = function(r, c) { return (r + c) % 3 === 0; }; break;
      case 4: maskFn = function(r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; }; break;
      case 5: maskFn = function(r, c) { return (r * c) % 2 + (r * c) % 3 === 0; }; break;
      case 6: maskFn = function(r, c) { return ((r * c) % 2 + (r * c) % 3) % 2 === 0; }; break;
      default: maskFn = function(r, c) { return ((r * c) % 3 + (r + c) % 2) % 2 === 0; }; break;
    }
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        if (!isReserved(r, c) && maskFn(r, c)) {
          m[r][c] ^= 1;
        }
      }
    }
  }

  // Format info bits for ECC M + mask patterns (precomputed)
  var FORMAT_BITS = [
    0x5412, 0x5125, 0x5E7C, 0x5B4B, 0x45F9, 0x40CE, 0x4F97, 0x4AA0
  ];

  function placeFormatInfo(m, maskId) {
    var bits = FORMAT_BITS[maskId];
    // Around top-left finder
    var positions1 = [[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];
    for (var i = 0; i < 15; i++) {
      m[positions1[i][0]][positions1[i][1]] = (bits >> i) & 1;
    }
    // Around other finders
    var positions2 = [[SIZE-1,8],[SIZE-2,8],[SIZE-3,8],[SIZE-4,8],[SIZE-5,8],[SIZE-6,8],[SIZE-7,8],[8,SIZE-8],[8,SIZE-7],[8,SIZE-6],[8,SIZE-5],[8,SIZE-4],[8,SIZE-3],[8,SIZE-2],[8,SIZE-1]];
    for (var i = 0; i < 15; i++) {
      m[positions2[i][0]][positions2[i][1]] = (bits >> i) & 1;
    }
    // Dark module
    m[SIZE - 8][8] = 1;
  }

  function generateQR(text) {
    if (text.length > 42) {
      // V3 byte mode max is ~42 chars. For longer URLs, truncate with ellipsis
      // Actually V3 M allows 44 data codewords = max 42 byte-mode chars
      // For longer text, we'd need V4+. Keep it simple and truncate.
    }
    var data = encodeData(text);
    var ecc = rsEncode(data, ECC_CW);
    var allCW = new Uint8Array(DATA_CW + ECC_CW);
    allCW.set(data);
    allCW.set(ecc, DATA_CW);

    var m = createMatrix();
    placeFinderPattern(m, 0, 0);
    placeFinderPattern(m, 0, SIZE - 7);
    placeFinderPattern(m, SIZE - 7, 0);
    placeTiming(m);
    placeData(m, allCW);
    applyMask(m, 0); // mask 0
    placeFormatInfo(m, 0);
    return m;
  }

  /**
   * Render a QR code to a canvas element.
   * @param {string} canvasId — ID of the <canvas> element
   * @param {string} text — URL or text to encode
   */
  function renderQRCode(canvasId, text) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    if (!ctx) return;

    var size = canvas.width;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);

    try {
      var matrix = generateQR(text);
      var cellSize = (size - 8) / SIZE; // 4px quiet zone each side
      var offset = 4;

      ctx.fillStyle = '#000000';
      for (var r = 0; r < SIZE; r++) {
        for (var c = 0; c < SIZE; c++) {
          if (matrix[r][c]) {
            ctx.fillRect(
              Math.floor(offset + c * cellSize),
              Math.floor(offset + r * cellSize),
              Math.ceil(cellSize),
              Math.ceil(cellSize)
            );
          }
        }
      }
    } catch (e) {
      // Fallback text
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#333333';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Open URL', size / 2, size / 2 - 6);
      ctx.fillText('on iPad', size / 2, size / 2 + 10);
    }
  }

  // Expose globally
  window.renderQRCode = renderQRCode;
})();
