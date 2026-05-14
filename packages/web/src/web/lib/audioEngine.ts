/**
 * GROOVA Audio Engine
 * Handles playback, sync, speed changes with pitch preservation
 * Uses Web Audio API — all processing on device
 */

import { useGROOVA } from "./store";

export type PlaybackNodes = {
  source: AudioBufferSourceNode;
  gainNode: GainNode;
};

class AudioEngine {
  private ctx: AudioContext | null = null;
  private activeNodes: Map<string, PlaybackNodes> = new Map();
  private masterGain: GainNode | null = null;
  private startedAt = 0;
  private offsetAt = 0;
  private animFrame: number | null = null;

  getContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  async resumeContext() {
    const ctx = this.getContext();
    if (ctx.state === "suspended") {
      await ctx.resume();
    }
    return ctx;
  }

  play(offsetSeconds = 0) {
    const ctx = this.getContext();
    const store = useGROOVA.getState();

    this.stop();

    // iOSはユーザー操作後でも suspended になることがある
    const startPlayback = () => {
      this.startedAt = ctx.currentTime;
      this.offsetAt = offsetSeconds;

      store.tracks.forEach((track) => {
        if (!track.audioBuffer || track.muted) return;
        if (store.soloedTrack && store.soloedTrack !== track.id) return;

        const source = ctx.createBufferSource();
        source.buffer = track.audioBuffer;
        source.playbackRate.value = track.speed ?? 1;
        source.loop = false;

        const gainNode = ctx.createGain();
        gainNode.gain.value = track.volume ?? 1;

        source.connect(gainNode);
        gainNode.connect(this.masterGain!);

        const trimStart = track.trimStart ?? 0;
        const bufDuration = track.audioBuffer.duration;
        const trimEnd = track.trimEnd ?? bufDuration;
        const clipDuration = trimEnd - trimStart;

        // offsetSeconds がトラックの範囲内か確認
        if (offsetSeconds <= trimEnd) {
          const playFrom = Math.max(0, offsetSeconds - trimStart);
          const remaining = clipDuration - playFrom;
          if (remaining > 0.01) {
            source.start(ctx.currentTime, trimStart + playFrom, remaining);
          }
        }

        this.activeNodes.set(track.id, { source, gainNode });
      });

      this.startAnimLoop();
    };

    if (ctx.state === "suspended") {
      ctx.resume().then(startPlayback);
    } else {
      startPlayback();
    }
  }

  stop() {
    this.activeNodes.forEach(({ source }) => {
      try { source.stop(); } catch {}
    });
    this.activeNodes.clear();
    if (this.animFrame) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }
  }

  getCurrentTime(): number {
    if (!this.ctx || !useGROOVA.getState().isPlaying) return this.offsetAt;
    return this.offsetAt + (this.ctx.currentTime - this.startedAt);
  }

  updateVolume(trackId: string, volume: number) {
    const nodes = this.activeNodes.get(trackId);
    if (nodes) nodes.gainNode.gain.value = volume;
  }

  private startAnimLoop() {
    const tick = () => {
      const t = this.getCurrentTime();
      useGROOVA.getState().setPlayheadTime(t);
      this.animFrame = requestAnimationFrame(tick);
    };
    this.animFrame = requestAnimationFrame(tick);
  }

  /**
   * Export mixed audio as WAV
   */
  async exportWAV(sampleRate = 44100, bitDepth = 16): Promise<Blob> {
    const store = useGROOVA.getState();
    const tracks = store.tracks.filter((t) => t.audioBuffer);

    if (tracks.length === 0) throw new Error("No tracks to export");

    // Find max duration
    let maxDuration = 0;
    tracks.forEach((t) => {
      const buf = t.audioBuffer!;
      const dur = (t.trimEnd || buf.duration) - t.trimStart;
      if (dur > maxDuration) maxDuration = dur;
    });

    const numSamples = Math.ceil(maxDuration * sampleRate);
    const mixed = new Float32Array(numSamples);

    // Mix all tracks
    tracks.forEach((track) => {
      if (track.muted) return;
      const buf = track.audioBuffer!;
      const srcRate = buf.sampleRate;
      const trimStart = track.trimStart;
      const speed = track.speed;
      const volume = track.volume;
      const channelData = buf.getChannelData(0);

      for (let i = 0; i < numSamples; i++) {
        const t = i / sampleRate;
        const srcT = trimStart + t * speed;
        const srcI = Math.floor(srcT * srcRate);
        if (srcI >= 0 && srcI < channelData.length) {
          mixed[i] += channelData[srcI] * volume;
        }
      }
    });

    // Normalize to prevent clipping
    let peak = 0;
    mixed.forEach((s) => { if (Math.abs(s) > peak) peak = Math.abs(s); });
    if (peak > 1) mixed.forEach((_, i) => { mixed[i] /= peak; });

    return encodeWAV(mixed, sampleRate, bitDepth);
  }
}

function encodeWAV(samples: Float32Array, sampleRate: number, bitDepth: number): Blob {
  const bytesPerSample = bitDepth / 8;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);

  if (bitDepth === 16) {
    for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
  } else {
    for (let i = 0; i < samples.length; i++) {
      view.setFloat32(44 + i * 4, samples[i], true);
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

export const audioEngine = new AudioEngine();
