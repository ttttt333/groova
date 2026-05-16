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

        // タイムライン上のクリップ開始位置（秒）
        const trackTimelineOffset = store.trackOffsets[track.id] ?? 0;

        const trimStart = track.trimStart ?? 0;
        const bufDuration = track.audioBuffer.duration;
        const trimEnd = track.trimEnd ?? bufDuration;
        const clipDuration = (trimEnd - trimStart) / (track.speed ?? 1);

        // クリップのタイムライン上の終端
        const clipEnd = trackTimelineOffset + clipDuration;

        // プレイヘッドがクリップ終端を過ぎていたらスキップ
        if (offsetSeconds >= clipEnd) return;

        const source = ctx.createBufferSource();
        source.buffer = track.audioBuffer;
        // speed: masterBpm / track.bpm でリアルタイム計算
        const computedSpeed = (track.bpm && track.bpm > 0 && store.masterBpm > 0)
          ? store.masterBpm / track.bpm
          : (track.speed ?? 1);
        source.playbackRate.value = computedSpeed;
        source.loop = false;

        const gainNode = ctx.createGain();
        const vol = track.volume ?? 1;
        source.connect(gainNode);
        gainNode.connect(this.masterGain!);

        const fadeIn = track.fadeIn ?? 0;
        const fadeOut = track.fadeOut ?? 0;

        if (offsetSeconds < trackTimelineOffset) {
          // プレイヘッドがクリップ開始前 → 未来にスケジュール
          const startDelay = trackTimelineOffset - offsetSeconds;
          const startAt = ctx.currentTime + startDelay;
          const endAt = startAt + clipDuration;

          if (fadeIn > 0) {
            gainNode.gain.setValueAtTime(0, startAt);
            gainNode.gain.linearRampToValueAtTime(vol, startAt + fadeIn);
          } else {
            gainNode.gain.setValueAtTime(vol, startAt);
          }
          if (fadeOut > 0) {
            const fadeOutStart = Math.max(startAt, endAt - fadeOut);
            gainNode.gain.setValueAtTime(vol, fadeOutStart);
            gainNode.gain.linearRampToValueAtTime(0, endAt);
          }

          source.start(startAt, trimStart, (trimEnd - trimStart));
        } else {
          // プレイヘッドがクリップ内 → 即再生（途中から）
          const elapsed = offsetSeconds - trackTimelineOffset; // クリップ内の経過時間（等速基準）
          const playFrom = trimStart + elapsed * computedSpeed; // バッファ内の再生開始位置
          const remaining = trimEnd - playFrom;
          if (remaining < 0.01) return;

          const startAt = ctx.currentTime;
          const endAt = startAt + remaining / computedSpeed;

          if (fadeIn > 0 && elapsed < fadeIn) {
            gainNode.gain.setValueAtTime(0, startAt);
            gainNode.gain.linearRampToValueAtTime(vol, startAt + (fadeIn - elapsed));
          } else {
            gainNode.gain.setValueAtTime(vol, startAt);
          }
          if (fadeOut > 0) {
            const fadeOutStart = Math.max(startAt, endAt - fadeOut);
            gainNode.gain.setValueAtTime(vol, fadeOutStart);
            gainNode.gain.linearRampToValueAtTime(0, endAt);
          }

          source.start(startAt, playFrom, remaining);
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

  /**
   * 一時停止 — 現在位置を保持してノードだけ停止。
   * 再開は play(getCurrentTime()) で行う。
   */
  pause(): void {
    // 現在位置を保存してから stop
    this.offsetAt = this.getCurrentTime();
    this.activeNodes.forEach(({ source }) => {
      try { source.stop(); } catch {}
    });
    this.activeNodes.clear();
    if (this.animFrame) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }
  }

  /**
   * プレイヘッドをシークする。
   * 再生中なら止めて新しい位置から再スタート。
   * 停止中なら offsetAt だけ更新。
   */
  seekTo(offsetSeconds: number): void {
    const wasPlaying = useGROOVA.getState().isPlaying;
    this.stop();
    this.offsetAt = Math.max(0, offsetSeconds);
    if (wasPlaying) {
      this.play(this.offsetAt);
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

  /**
   * FX — 短時間エフェクトをマスターに掛ける
   * rise: フィルタが開いていく
   * drop: ボリューム急落
   * reverse: 逆再生シミュレーション（ピッチ下降）
   * tapestop: ピッチ/速度急停止シミュレーション
   * beatrepeat: 短いループ（グリッチ）
   * bassdrop: ローパス+volume punch
   * vocalchop: bandpassチョップ
   * echo: フィードバックディレイ
   * airspace: リバーブ風ホワイトノイズ
   */
  applyFX(fxId: string): void {
    const ctx = this.getContext();
    const now = ctx.currentTime;
    const dest = this.masterGain ?? ctx.destination;

    if (fxId === "rise") {
      // ハイパスフィルタが徐々に開く
      const filter = ctx.createBiquadFilter();
      filter.type = "highpass";
      filter.frequency.setValueAtTime(2000, now);
      filter.frequency.exponentialRampToValueAtTime(20, now + 2);
      filter.connect(dest);
      // ノードを差し込む代わりに、短時間のホワイトノイズライズとして表現
      const bufSize = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) d[i] = (Math.random() * 2 - 1) * 0.15;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.4, now + 1.5);
      gain.gain.linearRampToValueAtTime(0, now + 2);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      src.start(now);
    } else if (fxId === "drop") {
      // masterGain を一瞬下げてから戻す
      if (this.masterGain) {
        const vol = this.masterGain.gain.value;
        this.masterGain.gain.setValueAtTime(vol, now);
        this.masterGain.gain.linearRampToValueAtTime(0, now + 0.3);
        this.masterGain.gain.linearRampToValueAtTime(vol, now + 0.8);
      }
    } else if (fxId === "reverse") {
      // ピッチ下降（全ノードのplaybackRate）
      this.activeNodes.forEach(({ source }) => {
        try {
          source.playbackRate.setValueAtTime(source.playbackRate.value, now);
          source.playbackRate.linearRampToValueAtTime(0.01, now + 1.5);
          source.playbackRate.linearRampToValueAtTime(source.playbackRate.value, now + 2);
        } catch {}
      });
    } else if (fxId === "tapestop") {
      // 速度をゼロに急落
      this.activeNodes.forEach(({ source }) => {
        try {
          const v = source.playbackRate.value;
          source.playbackRate.setValueAtTime(v, now);
          source.playbackRate.exponentialRampToValueAtTime(0.001, now + 1);
          source.playbackRate.setValueAtTime(v, now + 1.05);
        } catch {}
      });
    } else if (fxId === "beatrepeat") {
      // 短いグリッチノイズバースト
      for (let i = 0; i < 8; i++) {
        const bufSize = Math.floor(ctx.sampleRate * 0.05);
        const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let j = 0; j < bufSize; j++) d[j] = Math.random() * 2 - 1;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const gain = ctx.createGain();
        gain.gain.value = 0.3;
        src.connect(gain);
        gain.connect(ctx.destination);
        src.start(now + i * 0.06);
      }
    } else if (fxId === "bassdrop") {
      // サブベースパンチ
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(60, now);
      osc.frequency.exponentialRampToValueAtTime(20, now + 1.5);
      gain.gain.setValueAtTime(0.8, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 1.5);
    } else if (fxId === "vocalchop") {
      // バンドパスチョップ × 6
      for (let i = 0; i < 6; i++) {
        const osc = ctx.createOscillator();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();
        filter.type = "bandpass";
        filter.frequency.value = 800 + i * 200;
        osc.type = "sawtooth";
        osc.frequency.value = 120 + i * 30;
        gain.gain.setValueAtTime(0.15, now + i * 0.08);
        gain.gain.setValueAtTime(0, now + i * 0.08 + 0.05);
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.08);
        osc.stop(now + i * 0.08 + 0.07);
      }
    } else if (fxId === "echo") {
      // フィードバックディレイ（ホワイトノイズベース）
      const delay = ctx.createDelay(2);
      delay.delayTime.value = 0.375; // 1/8 note at 160bpm approx
      const feedback = ctx.createGain();
      feedback.gain.value = 0.5;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 2);
      const bufSize = ctx.sampleRate * 0.1;
      const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) d[i] = (Math.random() * 2 - 1) * 0.5;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(delay);
      delay.connect(feedback);
      feedback.connect(delay);
      delay.connect(gain);
      gain.connect(ctx.destination);
      src.start(now);
    } else if (fxId === "airspace") {
      // ホワイトノイズリバーブ風
      const bufSize = ctx.sampleRate * 2.5;
      const buf = ctx.createBuffer(2, bufSize, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < bufSize; i++) {
          d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.8));
        }
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 2.5);
      src.connect(gain);
      gain.connect(ctx.destination);
      src.start(now);
    }
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
