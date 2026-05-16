/**
 * GROOVA Audio Engine
 * Handles playback, sync, speed changes with pitch preservation
 * Uses Web Audio API — all processing on device
 *
 * iOS Silent Mode workaround:
 *   HTMLAudioElement で一度でも音を鳴らすと、以降 Web Audio API が
 *   サイレントモードでも「メディア再生」カテゴリに昇格する。
 *   unlockContext() 内で data-URI の無音 mp3 を再生してこれを実現。
 */

import { useGROOVA } from "./store";

export type PlaybackNodes = {
  source: AudioBufferSourceNode;
  gainNode: GainNode;
};

// 極小の無音 mp3 (< 200 bytes) — iOS で media playback session を開始するため
const SILENCE_MP3 =
  "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYoRBqMAAAAAAD/+1DEAAAHAAGf9AAAIgAANIAAAARMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVQ==";

let silenceUnlocked = false;

class AudioEngine {
  private ctx: AudioContext | null = null;
  private activeNodes: Map<string, PlaybackNodes> = new Map();
  private masterGain: GainNode | null = null;
  private startedAt = 0;
  private offsetAt = 0;
  private animFrame: number | null = null;

  getContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      this.masterGain = this.ctx.createGain();
      this.masterGain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  /**
   * iOS Safari 対応 — ユーザータップの同期コンテキストで呼ぶこと。
   *  1) AudioContext.resume()
   *  2) 無音 AudioBufferSourceNode を再生 (AudioContext unlock)
   *  3) HTMLAudioElement で無音 mp3 を再生 (Silent Mode bypass)
   * CRITICAL: async/await 禁止。iOS はタップ同期が外れると全て無効になる。
   */
  unlockContext(): void {
    const ctx = this.getContext();

    // 1) resume
    ctx.resume().catch(() => {});

    // 2) 無音バッファ再生 — AudioContext unlock
    try {
      const buf = ctx.createBuffer(1, 1, ctx.sampleRate);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
      src.onended = () => src.disconnect();
    } catch {}

    // 3) HTMLAudioElement trick — iOS Silent Mode bypass
    //    一度だけ実行すればOK。以降 Web Audio API は media category になる。
    if (!silenceUnlocked) {
      try {
        const audio = new Audio(SILENCE_MP3);
        audio.setAttribute("playsinline", "true");
        audio.volume = 0.01;
        const p = audio.play();
        if (p) p.catch(() => {});
        silenceUnlocked = true;
      } catch {}
    }
  }

  async ensureRunning(): Promise<AudioContext> {
    const ctx = this.getContext();
    if (ctx.state !== "running") {
      try { await ctx.resume(); } catch {}
    }
    return ctx;
  }

  play(offsetSeconds = 0): void {
    const ctx = this.getContext();
    const store = useGROOVA.getState();

    this.stop();

    const startPlayback = () => {
      this.startedAt = ctx.currentTime;
      this.offsetAt = offsetSeconds;

      store.tracks.forEach((track) => {
        if (!track.audioBuffer || track.muted) return;
        if (store.soloedTrack && store.soloedTrack !== track.id) return;

        const source = ctx.createBufferSource();
        source.buffer = track.audioBuffer;
        // speed: masterBpm / track.bpm でリアルタイム計算（store.speed は参照しない）
        const computedSpeed = (track.bpm && track.bpm > 0 && store.masterBpm > 0)
          ? store.masterBpm / track.bpm
          : (track.speed ?? 1);
        source.playbackRate.value = computedSpeed;
        source.loop = false;

        const gainNode = ctx.createGain();
        const vol = track.volume ?? 1;

        source.connect(gainNode);
        gainNode.connect(this.masterGain!);

        const trimStart = track.trimStart ?? 0;
        const bufDuration = track.audioBuffer.duration;
        const trimEnd = track.trimEnd ?? bufDuration;
        const clipDuration = trimEnd - trimStart;
        const fadeIn = track.fadeIn ?? 0;
        const fadeOut = track.fadeOut ?? 0;

        if (offsetSeconds <= trimEnd) {
          const playFrom = Math.max(0, offsetSeconds - trimStart);
          const remaining = clipDuration - playFrom;
          if (remaining > 0.01) {
            const startAt = ctx.currentTime;
            const endAt = startAt + remaining;

            // フェードイン
            if (fadeIn > 0 && playFrom < fadeIn) {
              gainNode.gain.setValueAtTime(0, startAt);
              gainNode.gain.linearRampToValueAtTime(vol, startAt + (fadeIn - playFrom));
              gainNode.gain.setValueAtTime(vol, startAt + (fadeIn - playFrom));
            } else {
              gainNode.gain.setValueAtTime(vol, startAt);
            }

            // フェードアウト
            if (fadeOut > 0) {
              const fadeOutStart = Math.max(startAt, endAt - fadeOut);
              gainNode.gain.setValueAtTime(vol, fadeOutStart);
              gainNode.gain.linearRampToValueAtTime(0, endAt);
            }

            source.start(startAt, trimStart + playFrom, remaining);
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

  stop(): void {
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

  updateVolume(trackId: string, volume: number): void {
    const nodes = this.activeNodes.get(trackId);
    if (nodes) nodes.gainNode.gain.value = volume;
  }

  /** 再生中にトラックの速度をリアルタイム変更 */
  updateSpeed(trackId: string, speed: number): void {
    const nodes = this.activeNodes.get(trackId);
    if (nodes) nodes.source.playbackRate.value = speed;
  }

  /** 全トラックの速度を一括更新 (BPM変更時) */
  updateAllSpeeds(trackSpeeds: Record<string, number>): void {
    for (const [trackId, speed] of Object.entries(trackSpeeds)) {
      this.updateSpeed(trackId, speed);
    }
  }

  private startAnimLoop(): void {
    // Timeline.tsx の rAF ループが getCurrentTime() を直接読むため、ここでは不要
    // (二重rAF + store書き込みによる全体再レンダリングを避ける)
  }

  async exportWAV(sampleRate = 44100, bitDepth = 16): Promise<Blob> {
    const store = useGROOVA.getState();
    const tracks = store.tracks.filter((t) => t.audioBuffer);
    if (tracks.length === 0) throw new Error("No tracks to export");

    let maxDuration = 0;
    tracks.forEach((t) => {
      const buf = t.audioBuffer!;
      const dur = (t.trimEnd || buf.duration) - t.trimStart;
      if (dur > maxDuration) maxDuration = dur;
    });

    const numSamples = Math.ceil(maxDuration * sampleRate);
    const mixed = new Float32Array(numSamples);

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
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
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
