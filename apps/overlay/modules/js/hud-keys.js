// The HUD's keys are taken from every other program on the machine for as long as they are held: Ctrl+Shift+V is
// paste-as-text in a browser, Ctrl+Shift+P a command palette, Ctrl+Shift+I the developer tools. So they are held
// only while the HUD is for something — while the driver is in the car — and are the computer's again when he
// gets out. No Electron here: main.js hands in what registers and unregisters a key.

/**
 *   keys        { accelerator: what to do }
 *   register    (accelerator, what to do) → whether the key was had
 *   unregister  (accelerator)
 *
 * { hold(inCar), held() }
 */
function createHudKeys({ keys, register, unregister, log = () => {} }) {
  const had = new Set();
  let holding = false;

  function hold(inCar) {
    inCar = !!inCar;
    if (inCar === holding) return;
    holding = inCar;
    for (const [key, act] of Object.entries(keys)) {
      try {
        if (inCar) {
          // A key another program holds is not had; the rest are.
          if (register(key, act) !== false) had.add(key);
          else log(`[RacingDesk] HUD key ${key} is held by another program`);
        } else if (had.delete(key)) {
          unregister(key);
        }
      } catch (e) {
        log(`[RacingDesk] HUD key ${key}: ${e.message}`);
      }
    }
    log(`[RacingDesk] HUD keys ${inCar ? 'held: he is in the car' : 'let go: he is out of the car'}`);
  }

  return { hold, held: () => [...had].sort() };
}

module.exports = { createHudKeys };
