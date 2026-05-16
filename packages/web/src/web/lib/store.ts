import { create } from "zustand";

export type TrackState = {
  id: string;
  name: string;
  file: File | null;
  audioBuffer: AudioBuffer | null;
  bpm: number | null;
  bpmConfidence: number;
  volume: number;
  speed: number; // multiplier
  trimStart: number; // seconds
  trimEnd: number | null; // null = end of file
  fadeIn: number;  // seconds
  fadeOut: number; // seconds
  waveformData: Float32Array | null;
  beatPositions: number[]; // seconds
  color: string;
  muted: boolean;
  solo: boolean;
  isAnalyzing: boolean;
};

export type SFXClip = {
  id: string;
  name: string;
  emoji: string;
  buffer: AudioBuffer | null;
  startTime: number; // position in seconds on timeline
  trackId: string;
};

export type Marker = {
  id: string;
  time: number;
  label: string;
  color: string;
};

export type EditTool = "move" | "split" | "trim" | "fade";

export type GROOVAState = {
  masterBpm: number;
  isPlaying: boolean;
  currentTime: number;
  playheadTime: number;
  tracks: TrackState[];
  sfxClips: SFXClip[];
  markers: Marker[];
  zoomLevel: number;
  snapToGrid: boolean;
  showGrid: boolean;
  activeTab: "tracks" | "fx" | "sfx" | "export";
  soloedTrack: string | null;
  audioContext: AudioContext | null;
  scrollResetCounter: number;
  trackOffsets: Record<string, number>;
  editTool: EditTool;

  // Actions
  setMasterBpm: (bpm: number) => void;
  setTrackOffset: (id: string, offsetSec: number) => void;
  setIsPlaying: (v: boolean) => void;
  setCurrentTime: (t: number) => void;
  setPlayheadTime: (t: number) => void;
  updateTrack: (id: string, patch: Partial<TrackState>) => void;
  addTrack: () => void;
  removeTrack: (id: string) => void;
  reorderTracks: (from: number, to: number) => void;
  setZoom: (z: number) => void;
  setSnapToGrid: (v: boolean) => void;
  setShowGrid: (v: boolean) => void;
  setActiveTab: (t: GROOVAState["activeTab"]) => void;
  setSoloedTrack: (id: string | null) => void;
  resetScroll: () => void;
  addMarker: (m: Marker) => void;
  removeMarker: (id: string) => void;
  addSFX: (sfx: SFXClip) => void;
  removeSFX: (id: string) => void;
  getOrCreateAudioContext: () => AudioContext;
  syncAllToBpm: () => void;
  setEditTool: (t: EditTool) => void;
  splitTrackAtPlayhead: (trackId: string, playheadSec?: number) => void;
};

const TRACK_COLORS = [
  "#a8ff3e", // acid green
  "#00f5ff", // electric cyan
  "#ff00aa", // magenta
  "#ff6b2b", // orange
  "#b266ff", // purple
  "#ffdd00", // yellow
];

let trackCounter = 2;

function makeTrack(idx: number): TrackState {
  return {
    id: `track-${idx}`,
    name: `トラック ${idx}`,
    file: null,
    audioBuffer: null,
    bpm: null,
    bpmConfidence: 0,
    volume: 0.8,
    speed: 1.0,
    trimStart: 0,
    trimEnd: null,
    fadeIn: 0,
    fadeOut: 0,
    waveformData: null,
    beatPositions: [],
    color: TRACK_COLORS[(idx - 1) % TRACK_COLORS.length],
    muted: false,
    solo: false,
    isAnalyzing: false,
  };
}

export const useGROOVA = create<GROOVAState>((set, get) => ({
  masterBpm: 120,
  isPlaying: false,
  currentTime: 0,
  playheadTime: 0,
  tracks: [makeTrack(1), makeTrack(2)],
  sfxClips: [],
  markers: [],
  zoomLevel: 1,
  snapToGrid: true,
  showGrid: true,
  activeTab: "tracks",
  soloedTrack: null,
  audioContext: null,
  scrollResetCounter: 0,
  trackOffsets: {},
  editTool: "move",

  setTrackOffset: (id, offsetSec) =>
    set((s) => ({ trackOffsets: { ...s.trackOffsets, [id]: offsetSec } })),

  setMasterBpm: (bpm) => {
    const clamped = Math.min(240, Math.max(40, bpm));
    // masterBpm だけ更新 — tracks は触らない（beatPositions の大量コピーを防ぐ）
    // speed は audioEngine.play() 時に masterBpm / track.bpm でリアルタイム計算する
    set({ masterBpm: clamped });
  },
  setIsPlaying: (v) => set({ isPlaying: v }),
  setCurrentTime: (t) => set({ currentTime: t }),
  setPlayheadTime: (t) => set({ playheadTime: t }),

  updateTrack: (id, patch) =>
    set((s) => ({
      tracks: s.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),

  addTrack: () => {
    trackCounter++;
    set((s) => ({
      tracks: s.tracks.length < 6 ? [...s.tracks, makeTrack(trackCounter)] : s.tracks,
    }));
  },

  removeTrack: (id) =>
    set((s) => ({ tracks: s.tracks.filter((t) => t.id !== id) })),

  reorderTracks: (from, to) =>
    set((s) => {
      const arr = [...s.tracks];
      const [item] = arr.splice(from, 1);
      arr.splice(to, 0, item);
      return { tracks: arr };
    }),

  setZoom: (z) => set({ zoomLevel: Math.min(64, Math.max(0.25, z)) }),
  setSnapToGrid: (v) => set({ snapToGrid: v }),
  setShowGrid: (v) => set({ showGrid: v }),
  setActiveTab: (t) => set({ activeTab: t }),
  setSoloedTrack: (id) => set({ soloedTrack: id }),
  resetScroll: () => set((s) => ({ scrollResetCounter: s.scrollResetCounter + 1 })),

  addMarker: (m) => set((s) => ({ markers: [...s.markers, m] })),
  removeMarker: (id) =>
    set((s) => ({ markers: s.markers.filter((m) => m.id !== id) })),

  addSFX: (sfx) => set((s) => ({ sfxClips: [...s.sfxClips, sfx] })),
  removeSFX: (id) =>
    set((s) => ({ sfxClips: s.sfxClips.filter((c) => c.id !== id) })),

  getOrCreateAudioContext: () => {
    let ctx = get().audioContext;
    if (!ctx) {
      ctx = new AudioContext();
      set({ audioContext: ctx });
    }
    return ctx;
  },

  syncAllToBpm: () => {
    const { masterBpm, tracks } = get();
    set({
      tracks: tracks.map((t) => {
        if (!t.bpm || t.bpm === 0) return t;
        return { ...t, speed: masterBpm / t.bpm };
      }),
    });
  },

  setEditTool: (t) => set({ editTool: t }),

  splitTrackAtPlayhead: (trackId, playheadSec) => {
    const state = get();
    const track = state.tracks.find((t) => t.id === trackId);
    if (!track?.audioBuffer) return;

    // プレイヘッド位置（引数 > store の順で優先）
    const phSec = playheadSec ?? state.playheadTime;
    const origOffset = state.trackOffsets[trackId] ?? 0;
    const trimStart = track.trimStart ?? 0;
    const duration = track.audioBuffer.duration;
    const trimEnd = track.trimEnd ?? duration;

    // クリップ内の位置に変換
    const clipEnd = origOffset + (trimEnd - trimStart);
    if (phSec <= origOffset + 0.1 || phSec >= clipEnd - 0.1) return;

    const elapsed = phSec - origOffset; // クリップ先頭からの経過時間
    const splitAt = trimStart + elapsed;       // バッファ内の分割位置

    // 前半: 既存トラックを trimEnd を splitAt に
    state.updateTrack(trackId, { trimEnd: splitAt, fadeOut: 0 });

    // 後半: 新規トラック追加
    state.addTrack();
    const newTracks = get().tracks;
    const newTrack = newTracks[newTracks.length - 1];
    if (newTrack) {
      state.updateTrack(newTrack.id, {
        name: track.name + " [2]",
        file: track.file,
        audioBuffer: track.audioBuffer,
        bpm: track.bpm,
        bpmConfidence: track.bpmConfidence,
        waveformData: track.waveformData,
        beatPositions: track.beatPositions,
        color: track.color,
        trimStart: splitAt,
        trimEnd: track.trimEnd ?? duration,
        fadeIn: 0,
        fadeOut: track.fadeOut ?? 0,
        speed: track.speed,
        volume: track.volume,
      });
      const newOffset = origOffset + elapsed;
      set((s) => ({ trackOffsets: { ...s.trackOffsets, [newTrack.id]: newOffset } }));
    }
  },
}));
