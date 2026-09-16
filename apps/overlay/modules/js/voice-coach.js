// Voice Coach — Web Speech API TTS system for Incident Coach
// Uses SpeechSynthesis for calm, coach-like voice prompts during racing.
// Priority system: higher-priority utterances can interrupt lower ones.
// Research basis: Kerwin & Bushman (2022) — never reinforces hostile attribution bias.

  // ═══════════════════════════════════════════════════════════════
  //  VOICE COACH — TTS ENGINE
  // ═══════════════════════════════════════════════════════════════

  const _voiceCoach = {
    synth: window.speechSynthesis || null,
    voice: null,
    enabled: true,
    volume: 0.7,
    rate: 0.9,          // slightly slower for calm delivery
    pitch: 0.85,        // slightly lower pitch
    queue: [],           // { text, priority, key }
    speaking: false,
    currentPriority: 0,
    lastSpokeAt: 0,
    minGapMs: 3000,      // 3s minimum between utterances
    initialized: false
  };

  // ── Message template pools (randomized per situation) ─────────
  // CRITICAL: No hostile attribution. Never imply intent. De-escalate the narrative.

  const _voiceTemplates = {
    // Priority 1 — Informational
    watch_info: [
      'Driver ahead is flagged.',
      'Flagged driver nearby.',
      'Heads up — flagged driver in range.'
    ],

    // Priority 2 — Advisory (approaching flagged driver)
    caution_approaching: [
      'Caution. Flagged driver {gap} seconds {direction}.',
      'Stay smooth. Flagged driver {direction}, {gap} seconds.',
      '{name} is {gap} seconds {direction}. You know the drill.'
    ],

    // Priority 3 — Warning (close proximity to danger driver)
    danger_approaching: [
      'Back off. Give yourself space.',
      'Flagged driver close. Build a gap.',
      '{name} is right there. Stay disciplined.'
    ],
    danger_close: [
      'Too close. Back off now.',
      'Gap is tight. Let it breathe.',
      'Ease off. Not worth the risk.'
    ],

    // Priority 4 — Urgent (rage pattern detected)
    rage_warning: [
      'Hey. Breathe. You\'re better than this.',
      'Slow hands. Smooth inputs. Let it go.',
      'Think about your safety rating. Not worth it.',
      'The best revenge is a clean finish ahead of them.'
    ],

    // Priority 5 — Critical (imminent retaliation)
    rage_critical: [
      'Hey. Breathe in. And out. Focus on your line.',
      'Pit lane is open. Let\'s reset. You\'ve got this.',
      'Walk away from this one. Race smart.',
      'Focus on this corner. Just this one.'
    ],

    // Contact just happened (immediate)
    contact_detected: [
      'Contact. Focus forward.',
      'Incident logged. Keep racing.',
      'That\'s racing. Stuff happens. Focus on your line.'
    ],

    // Cool-down mode
    cooldown_active: [
      'Cool-down active. Holding steady.',
      'Easy laps. Let the gap grow.',
      'Breathe in... and out. Focus on your braking marker.'
    ],
    cooldown_exit: [
      'Good. Gap established. Back to racing.',
      'Cool-down complete. You\'ve got this.',
      'Composure restored. Let\'s race.'
    ],

    // Positive reinforcement
    positive_clean_laps: [
      'Three clean laps since the incident. That\'s composure.',
      'Clean driving. Nicely done.',
      'Good discipline. Keep it up.'
    ],
    positive_pass: [
      'Clean pass. Smart racing.',
      'Nicely done. Position gained cleanly.'
    ]
  };

  // ── Voice selection ────────────────────────────────────────────

  function _initVoiceCoach() {
    if (!_voiceCoach.synth) {
      console.warn('[K10 VoiceCoach] SpeechSynthesis not available');
      return;
    }

    // Voices may load asynchronously
    const pickVoice = () => {
      const voices = _voiceCoach.synth.getVoices();
      if (!voices.length) return;

      // Prefer calm-sounding English voices
      const preferred = ['daniel', 'aaron', 'james', 'thomas', 'alex', 'fred'];
      const english = voices.filter(v => v.lang.startsWith('en'));

      // Try preferred names first
      for (const pref of preferred) {
        const match = english.find(v => v.name.toLowerCase().includes(pref));
        if (match) {
          _voiceCoach.voice = match;
          break;
        }
      }

      // Fallback to any English voice, preferring non-compact voices
      if (!_voiceCoach.voice) {
        _voiceCoach.voice = english.find(v => !v.name.toLowerCase().includes('compact')) || english[0] || voices[0];
      }

      _voiceCoach.initialized = true;
      console.log('[K10 VoiceCoach] Selected voice:', _voiceCoach.voice ? _voiceCoach.voice.name : 'default');
    };

    pickVoice();
    if (!_voiceCoach.initialized && _voiceCoach.synth.addEventListener) {
      _voiceCoach.synth.addEventListener('voiceschanged', pickVoice);
    }
  }

  // ── Utterance delivery ─────────────────────────────────────────

  function _speak(text, priority) {
    if (!_voiceCoach.synth || !_voiceCoach.enabled || !text) return;

    const now = Date.now();

    // Enforce minimum gap (unless high priority can interrupt)
    if (now - _voiceCoach.lastSpokeAt < _voiceCoach.minGapMs && priority < 3) {
      return;
    }

    // If currently speaking, only interrupt if new priority is higher
    if (_voiceCoach.speaking && priority <= _voiceCoach.currentPriority) {
      return;
    }

    // Cancel current speech if interrupting
    if (_voiceCoach.speaking && priority > _voiceCoach.currentPriority) {
      _voiceCoach.synth.cancel();
    }

    const utterance = new SpeechSynthesisUtterance(text);
    if (_voiceCoach.voice) utterance.voice = _voiceCoach.voice;
    utterance.volume = _voiceCoach.volume;
    utterance.rate = _voiceCoach.rate;
    utterance.pitch = _voiceCoach.pitch;

    utterance.onstart = () => {
      _voiceCoach.speaking = true;
      _voiceCoach.currentPriority = priority;
    };

    utterance.onend = () => {
      _voiceCoach.speaking = false;
      _voiceCoach.currentPriority = 0;
      _voiceCoach.lastSpokeAt = Date.now();
    };

    utterance.onerror = (e) => {
      _voiceCoach.speaking = false;
      _voiceCoach.currentPriority = 0;
      if (e.error !== 'canceled') {
        console.warn('[K10 VoiceCoach] Speech error:', e.error);
      }
    };

    _voiceCoach.synth.speak(utterance);
  }

  // ── Template resolution ────────────────────────────────────────

  function _resolveTemplate(key, vars) {
    const pool = _voiceTemplates[key];
    if (!pool || !pool.length) return '';

    // Random selection from pool
    const template = pool[Math.floor(Math.random() * pool.length)];

    if (!vars) return template;

    // Replace {name}, {gap}, {direction} placeholders
    return template
      .replace(/\{name\}/g, vars.name || 'Flagged driver')
      .replace(/\{gap\}/g, vars.gap != null ? (+vars.gap).toFixed(1) : '?')
      .replace(/\{direction\}/g, vars.direction || 'nearby');
  }

  // ── Public API ─────────────────────────────────────────────────

  /**
   * Queue a voice prompt by template key.
   * @param {string} promptKey — key into _voiceTemplates
   * @param {number} priority — 1 (info) to 5 (critical)
   * @param {object} [vars] — template variables: { name, gap, direction }
   */
  window.voiceCoachSpeak = function(promptKey, priority, vars) {
    if (!_voiceCoach.enabled) return;
    const text = _resolveTemplate(promptKey, vars);
    if (text) _speak(text, priority || 1);
  };

  /**
   * Speak arbitrary text (for dynamic messages not in templates).
   */
  window.voiceCoachSay = function(text, priority) {
    if (!_voiceCoach.enabled) return;
    _speak(text, priority || 1);
  };

  /**
   * Enable or disable voice coaching.
   */
  window.voiceCoachSetEnabled = function(enabled) {
    _voiceCoach.enabled = !!enabled;
    if (!enabled && _voiceCoach.synth) {
      _voiceCoach.synth.cancel();
    }
  };

  /**
   * Update voice settings.
   */
  window.voiceCoachSettings = function(opts) {
    if (opts.volume != null) _voiceCoach.volume = +opts.volume;
    if (opts.rate != null) _voiceCoach.rate = +opts.rate;
    if (opts.pitch != null) _voiceCoach.pitch = +opts.pitch;
    if (opts.enabled != null) _voiceCoach.enabled = !!opts.enabled;
  };

  // Initialize on load
  _initVoiceCoach();
