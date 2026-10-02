// Words, not capitals. He asked on 2026-10-02: "get rid of any all-caps text that isn't an acronym and also … use words
// instead of acronyms where we can", with his own words for the common ones — ABS: anti-lock, BB: bias, TC: traction,
// MIG: migration, ARB: rollbar. So nothing the HUD, the iPad view, the pages OBS draws or the desk shows is set in
// capitals (no text-transform: uppercase anywhere), and text is written in sentence case: "Leaderboard", "Laps to go",
// "Wheel max".
//
// This file is the list of what may still be written in capitals, and the one function the page puts a word from the
// wire through. The wire's words are the host's and the car list's — written in sentence case now, but a SimHub plugin
// installed before this change still sends NONE, ON, OFF, TRACK and the car list's old BRAKE BIAS — so the HUD shows
// every one of them in sentence case whatever sent it, and an acronym stays one. tests/unit/words-not-caps.spec.mjs
// holds every stylesheet, page and script that shows text to the same list.
(function () {
  'use strict';

  // Acronyms and initialisms that are written in capitals wherever they are shown. ABS is not one of them any more (it
  // is "Anti-lock"), nor TC ("Traction"), BB ("Bias"), MIG ("Migration"), ARB ("Rollbar"), SR ("Safety"), FFB ("Force
  // feedback") or iR ("iRating"): the words go where they fit, and the car list's own short labels (below) where they do
  // not. Single letters (a licence class, a corner's F or R, P for a position) are not words and are never changed.
  const ACRONYMS = Object.freeze([
    // Racing
    'DRS', 'P2P', 'DQ', 'DNF', 'SOF', 'GT', 'GTP', 'GTE', 'GTD', 'GTO', 'LMP', 'LMH', 'LMDH', 'TCR', 'WRC', 'IMSA', 'NASCAR',
    'FIA', 'DTM', 'ELMS', 'SCCA', 'MX', 'GR', 'AMG', 'BMW', 'VW', 'HPD', 'ARX', 'RSR', 'LMS', 'NSX', 'GTS', 'RS', 'GTI',
    'DSC', 'ESC', 'MDM', 'MGU', 'ERS', 'SOC', 'HYS', 'IBS',
    // The four corners: words where there is room, these where there is not
    'LF', 'RF', 'LR', 'RR', 'FL', 'FR', 'RL',
    // The rig, the app and its files
    'OBS', 'HUD', 'TV', 'PC', 'USB', 'COM', 'LAN', 'QR', 'URL', 'HTTP', 'HTTPS', 'API', 'AI', 'ID', 'JSON', 'PDF', 'PNG',
    'JPEG', 'TGA', 'MP4', 'MKV', 'GB', 'MB', 'KB', 'NVENC', 'CQVBR', 'GPU', 'CPU', 'RGB', 'UI', 'OK', 'DNA', 'SSD', 'HDD',
    'UTC', 'AM', 'PM', 'FOV', 'FPS', 'CC',
  ]);

  // The car list's own short labels for its controls, as the cars show them (packages/car-list/cars.json, "label"): what
  // a cell shows where the words do not fit, and what the desk shows beside them with the words as its title. TCLO and
  // the like are kept as the car shows them where no public source settles what they mean for that car.
  const CAR_LABELS = Object.freeze([
    'ABS', 'TC', 'BB', 'ARB', 'ESC', 'DSC', 'MDM', 'IBS', 'HYS', 'MGU', 'SOC', 'RF',
    'TCLO', 'TCLA', 'TCLON', 'TCLAT', 'TCS', 'TCF', 'TCR', 'CON', 'LAT',
    'BBAL', 'BAL', 'BBM', 'BBT', 'BMIG', 'MIG', 'BRAKEBAL', 'FARB', 'RARB', 'AR',
    'ENT', 'EXT', 'HISPD', 'PL', 'DB', 'EB', 'TRQ', 'OT', 'PAS', 'EPS', 'ATH', 'FDS', 'PED', 'PPS', 'THR', 'TH', 'TPS',
    'CAL', 'WJ', 'DRS', 'P2P',
  ]);

  const UPPER = new Set(ACRONYMS);
  const LABEL_UPPER = new Set([...ACRONYMS, ...CAR_LABELS]);

  const hasLetters = (s) => /[A-Za-z]/.test(s);
  const isCaps = (s) => hasLetters(s) && s === s.toUpperCase() && s !== s.toLowerCase();

  // One word of a text: kept as it is when it is not in capitals (iRating, McLaren, a name), when it has a digit in it
  // (P4, TC1, MP4, 25%), when it is one letter, or when every part of it between - / + & is an acronym of the set; else
  // it is set in lower case.
  function caseWord(word, upper) {
    const core = word.replace(/[^A-Za-z0-9]/g, '');
    if (!isCaps(core) || /\d/.test(core) || core.replace(/[^A-Za-z]/g, '').length < 2) return word;
    const parts = word.split(/[-/+&]/).map((p) => p.replace(/[^A-Za-z]/g, '')).filter(Boolean);
    if (parts.length > 0 && parts.every((p) => p.length < 2 || upper.has(p))) return word;
    return word.toLowerCase();
  }

  // A text in sentence case: every word in capitals that is not an acronym in lower case, and the first letter of the
  // whole a capital. "NONE" is "None", "SAFETY CAR" "Safety car", "MDM" "MDM", "TC TOGGLE" (a label) "TC toggle".
  function sentence(text, upper) {
    if (typeof text !== 'string' || !text) return text;
    const out = text.split(/(\s+)/).map((w) => (/^\s+$/.test(w) ? w : caseWord(w, upper))).join('');
    // The first word's first letter up, where the text begins with it and it is in lower case: iRating and dcABS are
    // names, and stay so, and "1 lap to green" begins with its number.
    const first = out.match(/^\s*[A-Za-z][A-Za-z'’-]*/);
    if (!first || first[0] !== first[0].toLowerCase()) return out;
    first.index = first[0].search(/[A-Za-z]/);
    return out.slice(0, first.index) + out.charAt(first.index).toUpperCase() + out.slice(first.index + 1);
  }

  /** A value the wire sends (a state's word, a position's name, DRS's), in sentence case. */
  const sentenceCase = (text) => sentence(text, UPPER);
  /** A control's label from the wire, in sentence case, the car's own short labels kept as the car shows them. */
  const labelCase = (text) => sentence(text, LABEL_UPPER);

  /** Whether a word may be shown in capitals: an acronym, or (labels) one of the car list's short labels. */
  const isAcronym = (word, { labels = false } = {}) => (labels ? LABEL_UPPER : UPPER).has(String(word).replace(/[^A-Za-z0-9]/g, ''));

  const api = { ACRONYMS, CAR_LABELS, sentenceCase, labelCase, isAcronym, isCaps };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else window.RacingDeskWords = api;
})();
