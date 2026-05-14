# GROOVA Build Task

## Status: In Progress

## Done
- [x] app_init
- [x] design.md
- [x] styles.css (Neon on Obsidian)
- [x] store.ts (Zustand state)
- [x] bpmAnalyzer.ts (DSP BPM detection)
- [x] audioEngine.ts (playback + WAV export)
- [x] WaveformCanvas.tsx (8-count grid, trim handles, scan anim)
- [x] TrackCard.tsx (file drop, BPM, speed, volume, mute)
- [x] MasterPanel.tsx (BPM, SYNC, play, tap tempo)
- [x] FXPanel.tsx (transition/dance/space FX)
- [x] SFXPanel.tsx (synth SFX: boom, crowd, etc)
- [x] ExportPanel.tsx (WAV/MP3 export)
- [x] pages/index.tsx (main layout + bottom nav)
- [x] app.tsx (routing)

## Next
- [ ] Update index.html (meta, PWA, fonts)
- [ ] Add PWA manifest
- [ ] Build & fix errors
- [ ] Deliver

## Architecture
- React + Vite + Tailwind + Zustand + Framer Motion
- Pure Web Audio API — no server processing
- BPM: autocorrelation DSP
- Export: raw WAV encode
- Mobile-first, max-width 480px
