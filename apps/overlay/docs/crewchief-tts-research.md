# CrewChief Voice & TTS Research

## Overview
This document summarizes research on how CrewChief voice systems work and explores approaches for implementing text-to-speech commentary in a SimHub dashboard plugin context.

---

## Part 1: How CrewChief Handles Voices

### Architecture: Pre-Recorded Audio Files, Not TTS

CrewChief uses **pre-recorded audio files** organized into folders, not real-time text-to-speech synthesis. This is fundamentally different from what many assume.

**Voice Pack Structure:**
- Voice packs consist of pre-recorded audio clips stored in the CrewChief `sounds` folder
- Audio files are organized by intent/phrase in subdirectories (e.g., `radio_check_Jim`, `radio_check_Mike`)
- Each intent folder can contain multiple audio files for variety
- During gameplay, CrewChief randomly selects from available files in each intent folder

**Voice Pack Installation:**
- Voice packs are installed by copying entire folder structures into `CrewChiefV4\sounds\alt\`
- Users select their preferred voice from a dropdown menu within CrewChief
- Multiple voice packs can be installed; only one is active at a time

### Voice Pack Generation (Modern Approach)

Modern custom voice pack creation uses **generative ML models for text-to-speech processing**:
- Tools like [crew-chief-autovoicepack](https://github.com/cktlco/crew-chief-autovoicepack) generate custom voice packs using AI speech synthesis
- The tool performs quality checks on audio duration, file size, and silence detection to ensure valid output
- Generated files are then organized into the standard CrewChief folder structure
- This means custom voice packs can be created from TTS, but they're then converted to static audio files

**Key Insight:** CrewChief itself doesn't do real-time TTS. It plays pre-recorded (or pre-generated) audio files at runtime.

### Voice Customization Limitations

You **cannot** create entirely new custom phrases unless they correspond to existing CrewChief intents. The predefined set of racing-relevant messages (gaps, lap times, tire data, etc.) maps to specific intent folders. You can add more variations within existing intents, but not arbitrary messages.

---

## Part 2: CrewChief API & Integration

### API Status & Capabilities

CrewChief does expose APIs for integration with sim racing applications:

**Simulator Integration:**
- Integrates with: rFactor2, Assetto Corsa, Project CARS, F1 2021, iRacing, Assetto Corsa Competizione, RaceRoom, Automobilista
- Monitors real-time telemetry data directly from sim APIs
- Provides voice callouts based on derived racing metrics (gap to leader, lap deltas, tire temps, etc.)

**REST API:**
- CrewChief includes a work-in-progress REST API for external integrations
- Can be used to send/receive telemetry data and enable pit menu functionality
- Can send simulator telemetry data to external endpoints

### Triggering CrewChief Voice Messages

**Voice Recognition Input:**
- CrewChief listens for voice commands via microphone (configurable trigger word, default "Chief")
- Voice recognition modes: Disabled, Hold button, Toggle button, Always on
- Voice commands are processed to trigger corresponding intent-based responses

**Direct Audio Triggering:**
- No built-in mechanism to directly trigger arbitrary CrewChief voice messages from external applications
- CrewChief voices are tightly coupled to its internal racing logic and telemetry processing

**Implication for SimHub:** You cannot easily call out to CrewChief to say "That was a great apex!" from your SimHub plugin. CrewChief's voice system is closed to external message injection.

---

## Part 3: SimHub Text-to-Speech Capabilities

### Built-In TTS Support

SimHub provides integrated text-to-speech functionality with multiple provider options:

**Microsoft Azure Speech:**
- Over 400 neural voices across 140+ languages/locales
- Customizable voice properties: style, emotion, role
- Real-time controls available
- Enterprise-grade service with high reliability

**Third-Party Integrations:**
- **PlayHT:** 800+ voices in 100+ languages; supports voice cloning, emotion, pitch, speed control
- **ElevenLabs:** Lifelike voices in 29+ languages; voice cloning; advanced controls for style, emotion, stability

**Important Note:** SimHub TTS is disabled by default in dashboard templates (likely for performance/cost reasons).

### How SimHub TTS Works

SimHub's TTS likely uses cloud API calls to synthesis providers rather than local speech synthesis. This means:
- Network latency (milliseconds to seconds depending on provider)
- Cost per request (if using paid services)
- Requires API keys for external providers
- Potential for service degradation if APIs are unavailable

---

## Part 4: Web Speech API for Browser-Based TTS

### Architecture & Capabilities

The **Web Speech API SpeechSynthesis** interface provides **local, browser-based text-to-speech**:

**How It Works:**
- Uses operating system speech synthesis engines (no server calls required)
- Available natively in all modern browsers
- getVoices() method returns list of available system voices
- Synthesis happens locally with minimal latency

**Advantages:**
- ✅ Zero network latency (purely local processing)
- ✅ No API keys or external service required
- ✅ Works offline
- ✅ Free (uses OS resources)
- ✅ Browser-native, no dependencies

**Limitations:**
- ❌ Voice quality varies by OS (Windows, macOS, Linux have different voices)
- ❌ Fewer customization options than cloud services
- ❌ Limited control over emotional tone/style
- ❌ Variable voice quality across platforms

**Browser Support:**
- Well-supported across modern browsers (Chrome, Firefox, Safari, Edge)
- Part of standard Web APIs

**Technical Resources:**
- [MDN Web Speech API Documentation](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API)
- [Web Speech API Specification](https://wicg.github.io/speech-api/)
- [Easy-Speech Library](https://github.com/leaonline/easy-speech) - Cross-browser wrapper

---

## Part 5: Implementation Approaches & Recommendation

### Option A: Web Speech API (Recommended for SimHub Plugins)

**Approach:**
- Use native `SpeechSynthesis` API within the Electron-based SimHub dashboard
- JavaScript code calls `window.speechSynthesis.speak(utterance)`
- No external dependencies or API keys needed

**Pros:**
- Extremely simple implementation (10-20 lines of JavaScript)
- Zero latency
- No costs
- Works offline
- Perfect fit for real-time race commentary

**Cons:**
- Limited voice selection and quality
- Cannot customize advanced parameters like emotion
- Voice availability varies by system

**Best For:**
- Enthusiast/custom implementations
- Real-time race-specific callouts where latency matters
- Environments without internet access

**Complexity Estimate:** Very Low (1-2 hours)

---

### Option B: Azure Speech Services (SimHub Built-In)

**Approach:**
- Use SimHub's native Azure TTS integration
- Configure API credentials in SimHub settings
- Call TTS from dashboard via SimHub's TTS plugin/feature

**Pros:**
- Enterprise-grade quality
- 400+ voices with fine-grained controls
- Supports multiple languages/accents
- SimHub native (may have built-in integration)

**Cons:**
- Requires Azure API keys and paid account
- Network latency (likely 500ms - 2 seconds per utterance)
- Per-request costs accumulate
- May not work offline
- Overkill for simple race callouts

**Best For:**
- Professional commentary overlays
- High-quality production content
- Implementations where cost isn't a concern

**Complexity Estimate:** Medium (3-5 hours including Azure setup)

---

### Option C: ElevenLabs API

**Approach:**
- Use ElevenLabs TTS API directly from dashboard
- Fetch pre-synthesized audio or stream synthesis
- Requires API key

**Pros:**
- Excellent voice quality (better than Azure for natural-sounding speech)
- Voice cloning available
- Good emotional control
- Developer-friendly API

**Cons:**
- Network latency required
- Paid API (per-character or subscription)
- Requires internet connection
- External dependency

**Best For:**
- Premium voiceover content
- Custom branded commentary voices
- Streaming-focused implementations

**Complexity Estimate:** Medium (4-6 hours including API integration)

---

### Option D: CrewChief Integration (Not Practical)

**Approach:**
- Attempt to trigger CrewChief voice messages from SimHub plugin

**Issues:**
1. No public API for triggering arbitrary voice messages
2. CrewChief's voice system is internally driven by racing telemetry
3. Voice files are pre-recorded; no real-time TTS capability
4. Would require reverse-engineering or CrewChief source modification
5. No documented integration point for external message injection

**Verdict:** ❌ Not feasible without CrewChief source code access and significant engineering effort.

---

## Recommended Path: Hybrid Approach

### For MVP (Minimum Viable Product)
**Use Web Speech API for initial implementation:**
1. Add simple JavaScript speech synthesis to dashboard overlay
2. Trigger commentary callouts based on telemetry events
3. Zero cost, zero latency, minimal development effort
4. Acceptable voice quality for functional prototype

### For Production/Premium
**Upgrade to Azure or ElevenLabs if:**
1. User feedback indicates voice quality is insufficient
2. Specific accent/personality is desired for commentary
3. Budget allows for API costs
4. Professional stream quality is required

**Keep Web Speech API as fallback** for offline operation or cost-sensitive scenarios.

---

## Technical Summary: Implementation Path

### Web Speech API Implementation (Recommended Starting Point)

```
1. Add TTS helper module to dashboard Electron code
2. Create function: speakCommentary(text, voiceIndex, rate, pitch)
3. Bind to race events (apex detection, incident callouts, etc.)
4. Add voice selection dropdown in dashboard settings
5. Optional: Add queuing/rate limiting to prevent voice overlap
6. Total effort: 4-8 hours for working prototype
```

### Architecture Considerations
- **Latency:** Web Speech API synthesis happens instantly (< 100ms)
- **Queuing:** Implement queue to prevent overlapping speech
- **Settings:** Allow users to disable, adjust rate/pitch, select voice
- **Fallback:** Graceful degradation if synthesis fails
- **Platform:** Works on Windows, macOS, Linux (voices vary)

---

## Sources & References

- [CrewChief Auto Voice Pack Generator](https://github.com/cktlco/crew-chief-autovoicepack)
- [CrewChief Official Forums](https://thecrewchief.org/)
- [CrewChief Voice Recognition Documentation](https://mr_belowski.gitlab.io/CrewChiefV4/VoiceRecognition_InstallationTraining.html)
- [SimHub Documentation - Text-to-Speech](https://docs.sim.ai/tools/tts)
- [MDN - Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API)
- [Web Speech API Specification](https://wicg.github.io/speech-api/)
- [Web Speech API Text-to-Speech Tutorial](https://www.twilio.com/en-us/blog/developers/tutorials/building-blocks/speech-to-text-browser-web-speech-api)
- [Easy-Speech Cross-Browser Library](https://github.com/leaonline/easy-speech)
