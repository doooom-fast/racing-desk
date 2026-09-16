// ═══════════════════════════════════════════════════════════════
// KEYBOARD SENDER — Send keystrokes to the iRacing window
//
// Main-process module. Uses PowerShell + .NET SendKeys to send
// keyboard input to the foreground window. Zero npm dependencies.
//
// Why PowerShell?
//   • Works on every Windows install (no node-gyp, no native modules)
//   • .NET's System.Windows.Forms.SendKeys maps cleanly to VK codes
//   • For numpad keys (iRacing replay), we use Add-Type with user32.dll
//     keybd_event since SendKeys can't distinguish numpad from main keys
//
// This module is ONLY used for automated replay recording (Phase 5).
// Normal overlay hotkeys use Electron's globalShortcut (keyboard.js).
// ═══════════════════════════════════════════════════════════════

const { exec, execSync } = require('child_process');
const path = require('path');

// ── Virtual key codes (Windows VK_ constants) ───────────────
const VK = {
  // Numpad keys (iRacing replay controls)
  NUMPAD0: 0x60, NUMPAD1: 0x61, NUMPAD2: 0x62, NUMPAD3: 0x63,
  NUMPAD4: 0x64, NUMPAD5: 0x65, NUMPAD6: 0x66, NUMPAD7: 0x67,
  NUMPAD8: 0x68, NUMPAD9: 0x69,
  // Modifiers
  SHIFT: 0x10, CONTROL: 0x11, ALT: 0x12,
  // Function keys
  F12: 0x7B,
  // Common
  RETURN: 0x0D, ESCAPE: 0x1B, SPACE: 0x20,
};

// ── Named key map for the replay director ───────────────────
// Maps friendly names to VK codes for easy use in replay-director.js
const KEY_MAP = {
  'numpad0': VK.NUMPAD0, 'numpad1': VK.NUMPAD1, 'numpad2': VK.NUMPAD2,
  'numpad3': VK.NUMPAD3, 'numpad4': VK.NUMPAD4, 'numpad5': VK.NUMPAD5,
  'numpad6': VK.NUMPAD6, 'numpad7': VK.NUMPAD7, 'numpad8': VK.NUMPAD8,
  'numpad9': VK.NUMPAD9,
  'shift': VK.SHIFT, 'control': VK.CONTROL, 'ctrl': VK.CONTROL,
  'alt': VK.ALT, 'f12': VK.F12,
  'enter': VK.RETURN, 'escape': VK.ESCAPE, 'space': VK.SPACE,
};

// ── PowerShell script template for keybd_event ──────────────
// Uses Add-Type to call user32.dll keybd_event directly.
// This is needed because .NET SendKeys can't send numpad-specific keys.
function buildKeyScript(vkCode, withShift, withCtrl) {
  var lines = [
    'Add-Type -TypeDefinition @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public class KeySender {',
    '  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);',
    '  public const uint KEYEVENTF_KEYUP = 0x0002;',
    '}',
    '"@',
  ];

  // Press modifiers
  if (withCtrl) {
    lines.push('[KeySender]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)');
  }
  if (withShift) {
    lines.push('[KeySender]::keybd_event(0x10, 0, 0, [UIntPtr]::Zero)');
  }

  // Press and release the key
  lines.push('[KeySender]::keybd_event(' + vkCode + ', 0, 0, [UIntPtr]::Zero)');
  lines.push('Start-Sleep -Milliseconds 50');
  lines.push('[KeySender]::keybd_event(' + vkCode + ', 0, [KeySender]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)');

  // Release modifiers (reverse order)
  if (withShift) {
    lines.push('[KeySender]::keybd_event(0x10, 0, [KeySender]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)');
  }
  if (withCtrl) {
    lines.push('[KeySender]::keybd_event(0x11, 0, [KeySender]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)');
  }

  return lines.join('\n');
}

// ── Send a single key press ─────────────────────────────────
// key: string name (e.g., 'numpad5') or VK code number
// options: { shift: bool, ctrl: bool }
// Returns a promise that resolves when the key has been sent.
function sendKey(key, options) {
  options = options || {};
  var vk = typeof key === 'number' ? key : (KEY_MAP[key.toLowerCase()] || 0);
  if (!vk) {
    return Promise.reject(new Error('Unknown key: ' + key));
  }

  var script = buildKeyScript(vk, !!options.shift, !!options.ctrl);

  return new Promise(function (resolve, reject) {
    // Use -EncodedCommand with Base64 to avoid all quoting/escaping issues
    var encoded = Buffer.from(script, 'utf16le').toString('base64');
    exec(
      'powershell -NoProfile -NonInteractive -EncodedCommand ' + encoded,
      { windowsHide: true, timeout: 5000 },
      function (err) {
        if (err) reject(new Error('PowerShell key send failed: ' + err.message));
        else resolve();
      }
    );
  });
}

// ── Send a sequence of keys with delays ─────────────────────
// steps: array of { key, shift?, ctrl?, delay? (ms before this key) }
// Returns a promise that resolves when all keys have been sent.
async function sendSequence(steps) {
  for (var i = 0; i < steps.length; i++) {
    var step = steps[i];
    if (step.delay && step.delay > 0) {
      await sleep(step.delay);
    }
    await sendKey(step.key, { shift: step.shift, ctrl: step.ctrl });
    // Small gap between keys so iRacing registers them
    await sleep(step.gap || 100);
  }
}

// ── Hold a key for a duration (e.g., fast-forward) ──────────
// Sends keydown, waits, sends keyup via a single PowerShell call.
function holdKey(key, durationMs, options) {
  options = options || {};
  var vk = typeof key === 'number' ? key : (KEY_MAP[key.toLowerCase()] || 0);
  if (!vk) {
    return Promise.reject(new Error('Unknown key: ' + key));
  }

  var sleepMs = Math.max(100, durationMs || 500);
  var lines = [
    'Add-Type -TypeDefinition @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public class KeySender {',
    '  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);',
    '  public const uint KEYEVENTF_KEYUP = 0x0002;',
    '}',
    '"@',
  ];

  if (options.shift) {
    lines.push('[KeySender]::keybd_event(0x10, 0, 0, [UIntPtr]::Zero)');
  }

  // Key down
  lines.push('[KeySender]::keybd_event(' + vk + ', 0, 0, [UIntPtr]::Zero)');
  lines.push('Start-Sleep -Milliseconds ' + sleepMs);
  // Key up
  lines.push('[KeySender]::keybd_event(' + vk + ', 0, [KeySender]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)');

  if (options.shift) {
    lines.push('[KeySender]::keybd_event(0x10, 0, [KeySender]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)');
  }

  var script = lines.join('\n');

  return new Promise(function (resolve, reject) {
    var encoded = Buffer.from(script, 'utf16le').toString('base64');
    exec(
      'powershell -NoProfile -NonInteractive -EncodedCommand ' + encoded,
      { windowsHide: true, timeout: sleepMs + 5000 },
      function (err) {
        if (err) reject(new Error('PowerShell hold key failed: ' + err.message));
        else resolve();
      }
    );
  });
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// ── Public API ──────────────────────────────────────────────
module.exports = {
  VK,
  KEY_MAP,
  sendKey,
  sendSequence,
  holdKey,
  sleep,
};
