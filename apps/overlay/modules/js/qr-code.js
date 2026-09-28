// A QR code for an address, drawn to a <canvas>: version 3 (29×29), error correction level M, byte mode, mask 0.
// No dependencies. It holds 42 bytes and no more, which is an address on the home network with its key
// (http://192.168.100.100:65535/?k=abcd2345 is 40); anything longer is refused rather than cut short, because a
// code of part of an address is a code of another address.
//
// The layout is the standard's (ISO/IEC 18004): three finder patterns with their separators, the timing patterns
// on row and column 6, one alignment pattern centred on (22, 22), the format information twice, the dark module,
// and the 70 codewords — 44 of data, 26 of error correction — laid in from the bottom right.

(function() {
  'use strict';

  var SIZE = 29, DATA_CW = 44, ECC_CW = 26;
  var MAX_BYTES = DATA_CW - 2;   // the mode and the count take 12 bits, the terminator 4
  var ALIGN = 22;                // the centre of version 3's one alignment pattern
  var QUIET = 4;                 // modules of white around the code, which a reader needs to find it

  // GF(256), modulo x^8 + x^4 + x^3 + x^2 + 1
  var EXP = new Uint8Array(256), LOG = new Uint8Array(256);
  (function() {
    var x = 1;
    for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x = (x << 1) ^ (x >= 128 ? 0x11d : 0); }
    EXP[255] = EXP[0];
  })();

  function gfMul(a, b) { return a === 0 || b === 0 ? 0 : EXP[(LOG[a] + LOG[b]) % 255]; }

  // The error correction codewords for `data`: the remainder of data·x^eccLen divided by the generator
  // (x − α^0)(x − α^1)…(x − α^(eccLen−1)). Both are kept highest power first.
  function rsEncode(data, eccLen) {
    var gen = [1];
    for (var i = 0; i < eccLen; i++) {
      var next = new Array(gen.length + 1);
      for (var j = 0; j < next.length; j++) next[j] = 0;
      for (var k = 0; k < gen.length; k++) {
        next[k] ^= gen[k];                       // × x
        next[k + 1] ^= gfMul(gen[k], EXP[i]);    // × α^i
      }
      gen = next;
    }
    var msg = new Uint8Array(data.length + eccLen);
    msg.set(data);
    for (var d = 0; d < data.length; d++) {
      var coeff = msg[d];
      if (coeff === 0) continue;
      for (var g = 0; g < gen.length; g++) msg[d + g] ^= gfMul(gen[g], coeff);
    }
    return msg.slice(data.length);
  }

  function utf8(text) {
    var bytes = [];
    for (var i = 0; i < text.length; i++) {
      var c = text.codePointAt(i);
      if (c > 0xffff) i++;
      if (c < 0x80) bytes.push(c);
      else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      else if (c < 0x10000) bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      else bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
    return bytes;
  }

  function encodeData(text) {
    var bytes = utf8(text);
    if (bytes.length > MAX_BYTES) throw new Error('Too long for the code: ' + bytes.length + ' bytes, and it holds ' + MAX_BYTES + '.');
    var bits = [];
    function pushBits(val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); }
    pushBits(4, 4);              // byte mode
    pushBits(bytes.length, 8);   // how many
    for (var i = 0; i < bytes.length; i++) pushBits(bytes[i], 8);
    for (var t = 0; t < 4 && bits.length < DATA_CW * 8; t++) bits.push(0);   // terminator
    while (bits.length % 8 !== 0) bits.push(0);
    var codewords = new Uint8Array(DATA_CW);
    for (var w = 0; w < bits.length / 8; w++) {
      var b = 0;
      for (var j = 0; j < 8; j++) b = (b << 1) | bits[w * 8 + j];
      codewords[w] = b;
    }
    var pad = [0xec, 0x11];
    for (var p = bits.length / 8, n = 0; p < DATA_CW; p++, n++) codewords[p] = pad[n % 2];
    return codewords;
  }

  // Where no data goes: the patterns, and the format information beside them.
  function isReserved(r, c) {
    if (r < 9 && c < 9) return true;                 // top-left finder, separator, format
    if (r < 9 && c >= SIZE - 8) return true;         // top-right
    if (r >= SIZE - 8 && c < 9) return true;         // bottom-left, and the dark module
    if (r === 6 || c === 6) return true;             // timing
    if (Math.abs(r - ALIGN) <= 2 && Math.abs(c - ALIGN) <= 2) return true;   // alignment
    return false;
  }

  // Dark border, light ring, dark 3×3 — and a light separator round it, where that is on the code.
  function placeFinderPattern(m, r, c) {
    for (var dr = -1; dr <= 7; dr++) {
      for (var dc = -1; dc <= 7; dc++) {
        var rr = r + dr, cc = c + dc;
        if (rr < 0 || rr >= SIZE || cc < 0 || cc >= SIZE) continue;
        var inside = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        var ring = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
        m[rr][cc] = inside && ring !== 2 ? 1 : 0;
      }
    }
  }

  function placeAlignmentPattern(m) {
    for (var dr = -2; dr <= 2; dr++) {
      for (var dc = -2; dc <= 2; dc++) {
        m[ALIGN + dr][ALIGN + dc] = Math.max(Math.abs(dr), Math.abs(dc)) === 1 ? 0 : 1;
      }
    }
  }

  function placeTiming(m) {
    for (var i = 8; i < SIZE - 8; i++) {
      m[6][i] = (i % 2 === 0) ? 1 : 0;
      m[i][6] = (i % 2 === 0) ? 1 : 0;
    }
  }

  // Two columns at a time from the right, up then down, most significant bit first; the seven modules left over
  // at the end stay light.
  function placeData(m, codewords) {
    var bitIdx = 0;
    var totalBits = codewords.length * 8;
    var col = SIZE - 1;
    var upward = true;
    while (col > 0) {
      if (col === 6) col--;   // the timing column is nobody's pair
      for (var row = 0; row < SIZE; row++) {
        var r = upward ? SIZE - 1 - row : row;
        for (var dc = 0; dc <= 1; dc++) {
          var c = col - dc;
          if (isReserved(r, c)) continue;
          if (bitIdx < totalBits) {
            m[r][c] = (codewords[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1;
            bitIdx++;
          }
        }
      }
      col -= 2;
      upward = !upward;
    }
  }

  // Mask 0: every module whose row and column add up to an even number is turned over.
  function applyMask(m) {
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        if (!isReserved(r, c) && (r + c) % 2 === 0) m[r][c] ^= 1;
      }
    }
  }

  // Level M, mask 0, with its own error correction and the standard's mask over it: 101010000010010.
  var FORMAT = 0x5412;

  // Bit 14 first. Once round the top-left finder; once split between the other two.
  function placeFormatInfo(m) {
    var first = [[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];
    var second = [[SIZE-1,8],[SIZE-2,8],[SIZE-3,8],[SIZE-4,8],[SIZE-5,8],[SIZE-6,8],[SIZE-7,8],
      [8,SIZE-8],[8,SIZE-7],[8,SIZE-6],[8,SIZE-5],[8,SIZE-4],[8,SIZE-3],[8,SIZE-2],[8,SIZE-1]];
    for (var i = 0; i < 15; i++) {
      var bit = (FORMAT >> (14 - i)) & 1;
      m[first[i][0]][first[i][1]] = bit;
      m[second[i][0]][second[i][1]] = bit;
    }
    m[SIZE - 8][8] = 1;   // the dark module
  }

  // The code as rows of 0 and 1, dark being 1. Throws for a text that does not fit.
  function generateQR(text) {
    var data = encodeData(String(text));
    var all = new Uint8Array(DATA_CW + ECC_CW);
    all.set(data);
    all.set(rsEncode(data, ECC_CW), DATA_CW);

    var m = [];
    for (var i = 0; i < SIZE; i++) m[i] = new Uint8Array(SIZE);
    placeFinderPattern(m, 0, 0);
    placeFinderPattern(m, 0, SIZE - 7);
    placeFinderPattern(m, SIZE - 7, 0);
    placeAlignmentPattern(m);
    placeTiming(m);
    placeData(m, all);
    applyMask(m);
    placeFormatInfo(m);
    return m;
  }

  /**
   * Draw the code for `text` on a canvas: black on white, whole pixels to a module, the quiet zone round it.
   * A canvas too small for that, or a text too long, is left blank and false comes back.
   * @param {string} canvasId — ID of the <canvas> element
   * @param {string} text — the address
   */
  function renderQRCode(canvasId, text) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return false;
    var ctx = canvas.getContext('2d');
    if (!ctx) return false;

    var size = Math.min(canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    var cell = Math.floor(size / (SIZE + 2 * QUIET));
    var matrix;
    try {
      matrix = generateQR(text);
    } catch (e) {
      return false;
    }
    if (cell < 1) return false;

    var left = Math.floor((canvas.width - cell * SIZE) / 2);
    var top = Math.floor((canvas.height - cell * SIZE) / 2);
    ctx.fillStyle = '#000000';
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        if (matrix[r][c]) ctx.fillRect(left + c * cell, top + r * cell, cell, cell);
      }
    }
    return true;
  }

  window.renderQRCode = renderQRCode;
  // For the tests, which read the code back.
  window.RacingDeskQR = { SIZE: SIZE, MAX_BYTES: MAX_BYTES, generate: generateQR, rsEncode: rsEncode };
})();
