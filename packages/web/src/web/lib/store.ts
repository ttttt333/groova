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
  rowId: string; // 同じ rowId のクリップは同じ行に表示
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

// Undo/Redo スナップショット
type Snapshot = {
  tracks: TrackState[];
  trackOffsets: Record<string, number>;
};

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
  // Undo/Redo
  undoStack: Snapshot[];
  redoStack: Snapshot[];

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
  // Undo/Redo
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
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
    rowId: `row-${idx}`,
  };
}

const MAX_HISTORY = 30;

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
  undoStack: [],
  redoStack: [],

  // ── Undo/Redo ──
  pushHistory: () => {
    const { tracks, trackOffsets, undoStack } = get();
    const snap: Snapshot = {
      tracks: tracks.map((t) => ({ ...t })),
      trackOffsets: { ...trackOffsets },
    };
    set({
      undoStack: [...undoStack.slice(-MAX_HISTORY + 1), snap],
      redoStack: [],
    });
  },

  undo: () => {
    const { undoStack, redoStack, tracks, trackOffsets } = get();
    if (undoStack.length === 0) return;
    const prev = undoStack[undoStack.length - 1];
    const current: Snapshot = {
      tracks: tracks.map((t) => ({ ...t })),
      trackOffsets: { ...trackOffsets },
    };
    set({
      tracks: prev.tracks,
      trackOffsets: prev.trackOffsets,
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, current],
    });
  },

  redo: () => {
    const { redoStack, undoStack, tracks, trackOffsets } = get();
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    const current: Snapshot = {
      tracks: tracks.map((t) => ({ ...t })),
      trackOffsets: { ...trackOffsets },
    };
    set({
      tracks: next.tracks,
      trackOffsets: next.trackOffsets,
      redoStack: redoStack.slice(0, -1),
      undoStack: [...undoStack, current],
    });
  },

  setTrackOffset: (id, offsetSec) =>
    set((s) => ({ trackOffsets: { ...s.trackOffsets, [id]: offsetSec } })),

  setMasterBpm: (bpm) => {
    const clamped = Math.min(240, Math.max(40, bpm));
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
    const idx = trackCounter;
    set((s) => ({
      tracks: s.tracks.length < 12 ? [...s.tracks, makeTrack(idx)] : s.tracks,
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

    // 履歴を保存してから分割
    state.pushHistory();

    const phSec = playheadSec ?? state.playheadTime;
    const origOffset = state.trackOffsets[trackId] ?? 0;
    const trimStart = track.trimStart ?? 0;
    const duration = track.audioBuffer.duration;
    const trimEnd = track.trimEnd ?? duration;

    const clipEnd = origOffset + (trimEnd - trimStart);
    if (phSec <= origOffset + 0.05 || phSec >= clipEnd - 0.05) return;

    const elapsed = phSec - origOffset;
    const splitAt = trimStart + elapsed;

    // 前半: trimEnd を縮める
    state.updateTrack(trackId, { trimEnd: splitAt, fadeOut: 0 });

    // 後半: 新規クリップを同じ rowId で追加
    trackCounter++;
    const newId = `track-${trackCounter}`;
    const newOffset = origOffset + elapsed;

    set((s) => ({
      tracks: [
        ...s.tracks,
        {
          ...track,
          id: newId,
          name: track.name,
          trimStart: splitAt,
          trimEnd: track.trimEnd ?? duration,
          fadeIn: 0,
          fadeOut: track.fadeOut ?? 0,
          rowId: track.rowId, // 同じ行に配置
        },
      ],
      trackOffsets: { ...s.trackOffsets, [newId]: newOffset },
    }));
  },
}));
