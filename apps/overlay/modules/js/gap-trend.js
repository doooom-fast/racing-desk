// Whether the cars ahead and behind are closing or dropping away: how the gap to each changed over his last lap.
//
// The gaps block says how far the car ahead and the car behind are; a driver at a glance wants to know which way it is
// going. The gap is taken at the start of every lap (the first frame of it), for the car that is there, and what is
// said during a lap is the change from the lap before to this one's start: the gap shrinking (▼) or growing (▲), in
// seconds a lap, coloured by whether it is good for him (closing on the car ahead, or pulling away from the one
// behind). A different car in the place starts it again, and a gap under 0.05s a lap is steady and says nothing.
//
// Pure: no DOM. poll-engine.js feeds it every frame in a race and writes what it says on the gaps block (glance layout
// only); the unit tests run it in Node.
(function () {
  'use strict';

  const STEADY = 0.05;   // seconds a lap under which the gap is not moving

  function create() {
    let lap = 0;
    // Per side: the car whose gap it is, the gap at the start of this lap, and at the start of the lap before.
    const side = { ahead: { name: '', now: 0, before: 0 }, behind: { name: '', now: 0, before: 0 } };

    function sample(s, name, gap, newLap) {
      if (!name || !(gap > 0)) { s.name = ''; s.now = 0; s.before = 0; return; }
      if (name !== s.name) { s.name = name; s.now = gap; s.before = 0; return; }   // another car: begin again
      if (newLap) { s.before = s.now; s.now = gap; }
    }

    // What one side says: null while there is nothing to say.
    function say(s, gap, good) {
      if (!s.name || !(s.before > 0) || !(s.now > 0)) return null;
      const change = s.now - s.before;            // seconds over the lap: negative, the gap has shrunk
      if (Math.abs(change) < STEADY) return null;
      const shrinking = change < 0;
      return {
        change,
        text: (shrinking ? '▼' : '▲') + Math.abs(change).toFixed(1) + '/lap',
        cls: (shrinking ? good.shrinking : !good.shrinking) ? 'good' : 'bad',
      };
    }

    /**
     * One frame: the lap he is on, the car ahead (its name and its gap in seconds) and the car behind. Returns what to
     * say of each: { ahead, behind }, each { text, cls: 'good' | 'bad', change } or null.
     */
    function update(currentLap, aheadName, aheadGap, behindName, behindGap) {
      const newLap = currentLap !== lap;
      if (currentLap < lap) { side.ahead = { name: '', now: 0, before: 0 }; side.behind = { name: '', now: 0, before: 0 }; }
      lap = currentLap;
      sample(side.ahead, aheadName, Math.abs(aheadGap), newLap);
      sample(side.behind, behindName, Math.abs(behindGap), newLap);
      return {
        ahead: say(side.ahead, aheadGap, { shrinking: true }),     // closing on the car ahead is good
        behind: say(side.behind, behindGap, { shrinking: false }), // the car behind closing is not
      };
    }

    function reset() { lap = 0; side.ahead = { name: '', now: 0, before: 0 }; side.behind = { name: '', now: 0, before: 0 }; }

    return { update, reset };
  }

  const api = { create, STEADY };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.RacingDeskGapTrend = api;
})();
