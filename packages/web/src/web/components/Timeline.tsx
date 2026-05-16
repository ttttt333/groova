import { useRef, useEffect, useCallback, useState } from "react";
import { Scissors } from "lucide-react";
import { useGROOVA, TrackState, EditTool } from "../lib/store";
import { analyzeBPM, decodeAudioFile, extractWaveform } from "../lib/bpmAnalyzer";
import { audioEngine } from "../lib/audioEngine";

const TRACK_HEIGHT = 76;
const RULER_HEIGHT = 32;
const LABEL_WIDTH = 52;
const PIXELS_PER_SEC_BASE = 80;

/**
 * GridOverlay — CSS background-image でグリッドを描画。
 * BPM/ズームが変わっても CSS プロパティ変更のみ（再レンダリングなし）。
 * 8カウント(=8拍)を1ブロックとし、4拍目に中間線、各拍に細い線を表示。
 */
function GridOverlay({
  bpm,
  pxPerSec,
  rulerHeight,
  totalHeight,
}: {
  bpm: number;
  pxPerSec: number;
  rulerHeight: number;
  totalHeight: string | number;
}) {
  const beatPx = (60 / bpm) * pxPerSec;    // 1拍のピクセル幅
  const bar8Px = beatPx * 8;               // 8拍（1小節×2）のピクセル幅
  const bar4Px = beatPx * 4;               // 4拍のピクセル幅

  // 重ね: 8カウント強線 + 4拍中間線 + 1拍細線
  // linear-gradient の繰り返しで一切 JS ループなし
  const bgImage = [
    // 8カウント: rgba(168,255,62,0.5) — 1.5px
    `repeating-linear-gradient(90deg, rgba(168,255,62,0.5) 0px, rgba(168,255,62,0.5) 1.5px, transparent 1.5px, transparent ${bar8Px}px)`,
    // 4拍: rgba(168,255,62,0.2) — 1px
    `repeating-linear-gradient(90deg, transparent 0px, transparent ${bar4Px - 1}px, rgba(168,255,62,0.2) ${bar4Px - 1}px, rgba(168,255,62,0.2) ${bar4Px}px, transparent ${bar4Px}px, transparent ${bar8Px}px)`,
    // 1拍: rgba(168,255,62,0.07) — 1px
    `repeating-linear-gradient(90deg, transparent 0px, transparent ${beatPx - 0.5}px, rgba(168,255,62,0.07) ${beatPx - 0.5}px, rgba(168,255,62,0.07) ${beatPx}px, transparent ${beatPx}px, transparent ${bar8Px}px)`,
  ].join(", ");

  return (
    <div
      style={{
        position: "absolute",
        top: rulerHeight,
        left: 0,
        width: "100%",
        height: `calc(${totalHeight} - ${rulerHeight}px)`,
        pointerEvents: "none",
        zIndex: 1,
        backgroundImage: bgImage,
        backgroundRepeat: "repeat",
      }}
    />
  );
}


function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 10);
  return `${m}:${String(s).padStart(2, "0")}.${ms}`;
}

export default function Timeline({ onSplitAtPlayhead }: { onSplitAtPlayhead?: (playheadSec: number) => void }) {
  const {
    tracks, updateTrack, masterBpm, showGrid,
    setPlayheadTime, isPlaying, zoomLevel, addTrack, setMasterBpm,
    scrollResetCounter, removeTrack,
    trackOffsets: storeTrackOffsets, setTrackOffset,
    editTool, setEditTool, splitTrackAtPlayhead,
  } = useGROOVA();

  const scrollRef = useRef<HTMLDivElement>(null);
  const rulerDragRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const playheadLineRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>();
  const isDraggingPlayhead = useRef(false);
  const scrollTargetRef = useRef<number | null>(null);
  const isDraggingTrack = useRef<{ id: string; startX: number; origOffset: number } | null>(null);
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);
  const needsWaveRedraw = useRef(true);
  const needsRulerRedraw = useRef(true);

  // ── 編集ツール状態 (store経由) ──
  const editToolRef = useRef<EditTool>(editTool);
  useEffect(() => { editToolRef.current = editTool; }, [editTool]);

  // trim ドラッグ状態
  const isTrimming = useRef<{
    id: string;
    side: "left" | "right";
    startX: number;
    origTrimStart: number;
    origTrimEnd: number;
    origOffset: number;
    duration: number;
  } | null>(null);

  // fade ドラッグ状態
  const isFading = useRef<{
    id: string;
    side: "in" | "out";
    startX: number;
    origFade: number;
    duration: number;
  } | null>(null);

  const trackOffsets = storeTrackOffsets;
  const setTrackOffsets = (updater: ((prev: Record<string, number>) => Record<string, number>) | Record<string, number>) => {
    const next = typeof updater === "function" ? updater(useGROOVA.getState().trackOffsets) : updater;
    Object.entries(next).forEach(([id, val]) => {
      if (useGROOVA.getState().trackOffsets[id] !== val) setTrackOffset(id, val);
    });
  };

  const pxPerSec = PIXELS_PER_SEC_BASE * zoomLevel;

  const topAudioTrack = tracks.find((t) => t.audioBuffer && t.beatPositions?.length > 0) ?? null;

  // rowId でグループ化 — 表示行の順序を決定
  // 同じ rowId を持つトラックは同じ行に描画する（分割後のクリップなど）
  const rows: TrackState[][] = [];
  const rowOrder: string[] = []; // rowId の出現順
  for (const t of tracks) {
    const rid = t.rowId ?? t.id;
    const idx = rowOrder.indexOf(rid);
    if (idx === -1) {
      rowOrder.push(rid);
      rows.push([t]);
    } else {
      rows[idx].push(t);
    }
  }
  // 各行の「代表トラック」(rowの先頭 = 最初に分割された前半)
  const rowRepresentatives = rows.map((r) => r[0]);

  const maxDuration = Math.max(
    30,
    ...tracks.map((t) => {
      const dur = t.audioBuffer?.duration || 0;
      const trimStart = t.trimStart ?? 0;
      const trimEnd = t.trimEnd ?? dur;
      const off = trackOffsets[t.id] || 0;
      return off + (trimEnd - trimStart);
    })
  );
  const canvasWidth = Math.max(maxDuration * pxPerSec + 200, 600);

  useEffect(() => {
    if (scrollResetCounter > 0 && scrollRef.current) {
      scrollTargetRef.current = null;
      scrollRef.current.scrollLeft = 0;
    }
  }, [scrollResetCounter]);



  useEffect(() => {
    needsWaveRedraw.current = true;
  }, [tracks, pxPerSec, trackOffsets, showGrid, masterBpm]);

  useEffect(() => {
    needsRulerRedraw.current = true;
  }, [pxPerSec, showGrid, masterBpm, maxDuration]);

  const playheadTimeRef = useRef(0);
  const isPlayingRef = useRef(isPlaying);
  const pxPerSecRef = useRef(pxPerSec);
  const showGridRef = useRef(showGrid);
  const topAudioTrackRef = useRef(topAudioTrack);
  const trackOffsetsRef = useRef(trackOffsets);
  const tracksRef = useRef(tracks);
  const masterBpmRef = useRef(masterBpm);
  const maxDurationRef = useRef(maxDuration);
  const canvasWidthRef = useRef(canvasWidth);

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { pxPerSecRef.current = pxPerSec; }, [pxPerSec]);
  useEffect(() => { showGridRef.current = showGrid; }, [showGrid]);
  useEffect(() => { topAudioTrackRef.current = topAudioTrack; }, [topAudioTrack]);
  useEffect(() => { trackOffsetsRef.current = trackOffsets; }, [trackOffsets]);
  useEffect(() => { tracksRef.current = tracks; }, [tracks]);
  useEffect(() => { masterBpmRef.current = masterBpm; }, [masterBpm]);
  useEffect(() => { maxDurationRef.current = maxDuration; }, [maxDuration]);
  useEffect(() => { canvasWidthRef.current = canvasWidth; }, [canvasWidth]);

  // ── drawTrack（フェードオーバーレイ付き） ──
  const drawTrack = useCallback((track: TrackState) => {
    const canvas = canvasRefs.current.get(track.id);
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const pxPerSec = pxPerSecRef.current;
    const trackOffsets = trackOffsetsRef.current;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#0d0d14";
    ctx.fillRect(0, 0, W, H);

    const offset = trackOffsets[track.id] || 0;
    const waveform = track.waveformData;
    const duration = track.audioBuffer?.duration || 0;

    if (waveform && duration > 0) {
      const clipX = offset * pxPerSec;
      const trimStart = track.trimStart ?? 0;
      const trimEnd = track.trimEnd ?? duration;
      const clipW = (trimEnd - trimStart) * pxPerSec;
      const trimStartX = clipX;
      const trimEndX = clipX + clipW;

      // クリップ背景
      ctx.fillStyle = track.color + "18";
      ctx.beginPath();
      ctx.roundRect(trimStartX, 2, clipW, H - 4, 4);
      ctx.fill();
      ctx.strokeStyle = track.color + "66";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(trimStartX, 2, clipW, H - 4, 4);
      ctx.stroke();

      // 波形描画（trimStart〜trimEnd の範囲のみ）
      const fullClipW = duration * pxPerSec;
      const samplesPerPx = waveform.length / fullClipW;
      const trimStartPx = trimStart * pxPerSec;

      if (samplesPerPx > 1) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(trimStartX, 0, clipW, H);
        ctx.clip();
        ctx.beginPath();
        const midY = H / 2;
        const ampScale = (H - 8) * 0.42;
        for (let px = 0; px < clipW; px++) {
          const srcPx = trimStartPx + px;
          const sStart = Math.floor(srcPx * samplesPerPx);
          const sEnd = Math.min(Math.ceil((srcPx + 1) * samplesPerPx), waveform.length);
          let max = 0;
          for (let s = sStart; s < sEnd; s++) { if (waveform[s] > max) max = waveform[s]; }
          const y = midY - max * ampScale;
          if (px === 0) ctx.moveTo(trimStartX + px, y); else ctx.lineTo(trimStartX + px, y);
        }
        for (let px = Math.floor(clipW) - 1; px >= 0; px--) {
          const srcPx = trimStartPx + px;
          const sStart = Math.floor(srcPx * samplesPerPx);
          const sEnd = Math.min(Math.ceil((srcPx + 1) * samplesPerPx), waveform.length);
          let max = 0;
          for (let s = sStart; s < sEnd; s++) { if (waveform[s] > max) max = waveform[s]; }
          ctx.lineTo(trimStartX + px, midY + max * ampScale);
        }
        ctx.closePath();
        ctx.fillStyle = track.color + "bb";
        ctx.fill();
        ctx.strokeStyle = track.color;
        ctx.lineWidth = 0.5;
        ctx.stroke();
        ctx.restore();
      } else {
        const pxPerSample = fullClipW / waveform.length;
        const barW = Math.max(1, pxPerSample - (pxPerSample > 3 ? 1 : 0));
        const midY = H / 2;
        const ampScale = (H - 8) * 0.42;
        const visStartSample = Math.max(0, Math.floor(trimStart * (waveform.length / duration)) - 2);
        const visEndSample = Math.min(waveform.length, Math.ceil(trimEnd * (waveform.length / duration)) + 2);
        ctx.save();
        ctx.beginPath();
        ctx.rect(trimStartX, 0, clipW, H);
        ctx.clip();
        ctx.fillStyle = track.color + "dd";
        for (let i = visStartSample; i < visEndSample; i++) {
          const amp = waveform[i];
          const barH = amp * ampScale * 2;
          const x = clipX + i * pxPerSample;
          ctx.fillRect(x, midY - barH / 2, barW, barH);
        }
        ctx.restore();
      }

      // トラック名・BPM
      ctx.fillStyle = track.color + "99";
      ctx.font = "bold 9px Space Grotesk, sans-serif";
      ctx.fillText(track.name, trimStartX + 6, H - 6);
      if (track.bpm) {
        ctx.fillStyle = track.color;
        ctx.font = "bold 9px JetBrains Mono, monospace";
        ctx.fillText(`${track.bpm}`, trimStartX + 6, 14);
      }

      // ── フェードイン オーバーレイ ──
      const fadeIn = track.fadeIn ?? 0;
      if (fadeIn > 0) {
        const fadeInPx = Math.min(fadeIn * pxPerSec, clipW);
        const grad = ctx.createLinearGradient(trimStartX, 0, trimStartX + fadeInPx, 0);
        grad.addColorStop(0, "#0d0d14ee");
        grad.addColorStop(1, "rgba(13,13,20,0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.rect(trimStartX, 2, fadeInPx, H - 4);
        ctx.fill();
        // フェードイン斜線
        ctx.strokeStyle = track.color + "88";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(trimStartX, H - 4);
        ctx.lineTo(trimStartX + fadeInPx, 2);
        ctx.stroke();
        // ハンドル (左上三角)
        ctx.fillStyle = track.color;
        ctx.beginPath();
        ctx.moveTo(trimStartX, 2);
        ctx.lineTo(trimStartX + 14, 2);
        ctx.lineTo(trimStartX, 16);
        ctx.closePath();
        ctx.fill();
      } else {
        // フェードインなしの時もハンドル表示（小さく）
        ctx.fillStyle = track.color + "55";
        ctx.beginPath();
        ctx.moveTo(trimStartX, 2);
        ctx.lineTo(trimStartX + 10, 2);
        ctx.lineTo(trimStartX, 12);
        ctx.closePath();
        ctx.fill();
      }

      // ── フェードアウト オーバーレイ ──
      const fadeOut = track.fadeOut ?? 0;
      if (fadeOut > 0) {
        const fadeOutPx = Math.min(fadeOut * pxPerSec, clipW);
        const grad = ctx.createLinearGradient(trimEndX - fadeOutPx, 0, trimEndX, 0);
        grad.addColorStop(0, "rgba(13,13,20,0)");
        grad.addColorStop(1, "#0d0d14ee");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.rect(trimEndX - fadeOutPx, 2, fadeOutPx, H - 4);
        ctx.fill();
        // フェードアウト斜線
        ctx.strokeStyle = track.color + "88";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(trimEndX - fadeOutPx, 2);
        ctx.lineTo(trimEndX, H - 4);
        ctx.stroke();
        // ハンドル (右上三角)
        ctx.fillStyle = track.color;
        ctx.beginPath();
        ctx.moveTo(trimEndX, 2);
        ctx.lineTo(trimEndX - 14, 2);
        ctx.lineTo(trimEndX, 16);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillStyle = track.color + "55";
        ctx.beginPath();
        ctx.moveTo(trimEndX, 2);
        ctx.lineTo(trimEndX - 10, 2);
        ctx.lineTo(trimEndX, 12);
        ctx.closePath();
        ctx.fill();
      }

      // ── リサイズハンドル（左端・右端） ──
      // 左端
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(trimStartX - 1, 0, 2, H);
      // 右端
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(trimEndX - 1, 0, 2, H);
      // 右端グリップ（縦3本線）
      ctx.fillStyle = track.color + "cc";
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(trimEndX - 8 + i * 3, H / 2 - 8, 1.5, 16);
      }
      // 左端グリップ
      for (let i = 0; i < 3; i++) {
        ctx.fillRect(trimStartX + 2 + i * 3, H / 2 - 8, 1.5, 16);
      }

      // ── BPM グリッド（Canvas描画 — offset考慮） ──
      if (showGridRef.current && masterBpmRef.current > 0) {
        const bpm = masterBpmRef.current;
        const beatPx = (60 / bpm) * pxPerSec;  // 1拍のピクセル幅
        const bar8Px = beatPx * 8;              // 8拍

        // クリップ内のみ描画（クリップ境界でクリップ）
        ctx.save();
        ctx.beginPath();
        ctx.rect(trimStartX, 0, clipW, H);
        ctx.clip();

        // 最初のビートの位置（clipX=offset*pxPerSec が基準）
        // タイムライン0秒からbeatPxごとのグリッド
        const firstBeat = Math.floor(clipX / beatPx) * beatPx;

        let x = firstBeat;
        while (x <= trimEndX + 1) {
          if (x >= trimStartX - 1) {
            const beatIndex = Math.round(x / beatPx);
            const isBar8 = beatIndex % 8 === 0;
            const isBar4 = beatIndex % 4 === 0;
            if (isBar8) {
              ctx.strokeStyle = "rgba(168,255,62,0.45)";
              ctx.lineWidth = 1.5;
            } else if (isBar4) {
              ctx.strokeStyle = "rgba(168,255,62,0.18)";
              ctx.lineWidth = 1;
            } else {
              ctx.strokeStyle = "rgba(168,255,62,0.06)";
              ctx.lineWidth = 0.8;
            }
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, H);
            ctx.stroke();
          }
          x += beatPx;
        }
        ctx.restore();
      }
    } else {
      ctx.strokeStyle = "#2a2a3a";
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(2, 2, W - 4, H - 4);
      ctx.setLineDash([]);
      ctx.fillStyle = "#2a2a3a";
      ctx.font = "11px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("タップして追加", W / 2, H / 2 + 4);
      ctx.textAlign = "left";
    }

    if (track.isAnalyzing) {
      const scanX = ((Date.now() % 2000) / 2000) * W;
      const grad = ctx.createLinearGradient(scanX - 40, 0, scanX + 40, 0);
      grad.addColorStop(0, "rgba(0,245,255,0)");
      grad.addColorStop(0.5, "rgba(0,245,255,0.7)");
      grad.addColorStop(1, "rgba(0,245,255,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(scanX - 40, 0, 80, H);
      return true;
    }
    return false;
  }, []);

  // ── drawRowTracks: 同じ行の全クリップを1つのCanvasに描画 ──
  const drawRowTracks = useCallback((rowTracks: TrackState[]) => {
    if (rowTracks.length === 0) return;
    // Canvasは代表トラック(先頭)のIDで管理
    const rep = rowTracks[0];
    const canvas = canvasRefs.current.get(rep.rowId ?? rep.id) ?? canvasRefs.current.get(rep.id);
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    // 背景クリア
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#0d0d14";
    ctx.fillRect(0, 0, W, H);

    // 各クリップを順番に描画（drawTrack は独自にclearするので、ここでは内部描画のみ呼ぶ）
    let hasAnalyzing = false;
    for (const t of rowTracks) {
      if (drawTrackOnCtx(ctx, t, W, H)) hasAnalyzing = true;
    }

    // 空行ガイド（全クリップが空の場合）
    if (rowTracks.every((t) => !t.audioBuffer)) {
      ctx.strokeStyle = "#2a2a3a";
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(2, 2, W - 4, H - 4);
      ctx.setLineDash([]);
      ctx.fillStyle = "#2a2a3a";
      ctx.font = "11px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("タップして追加", W / 2, H / 2 + 4);
      ctx.textAlign = "left";
    }

    if (hasAnalyzing) {
      const scanX = ((Date.now() % 2000) / 2000) * W;
      const grad = ctx.createLinearGradient(scanX - 40, 0, scanX + 40, 0);
      grad.addColorStop(0, "rgba(0,245,255,0)");
      grad.addColorStop(0.5, "rgba(0,245,255,0.7)");
      grad.addColorStop(1, "rgba(0,245,255,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(scanX - 40, 0, 80, H);
    }
  }, []);

  // ── drawTrackOnCtx: ctx を受け取って1クリップ分描画（clearしない） ──
  // drawTrack と同じロジックだが ctx / W / H を外から受け取る
  const drawTrackOnCtx = useCallback((ctx: CanvasRenderingContext2D, track: TrackState, W: number, H: number): boolean => {
    const pxPerSec = pxPerSecRef.current;
    const trackOffsets = trackOffsetsRef.current;

    const offset = trackOffsets[track.id] || 0;
    const waveform = track.waveformData;
    const duration = track.audioBuffer?.duration || 0;
    if (!waveform || duration <= 0) return false;

    const clipX = offset * pxPerSec;
    const trimStart = track.trimStart ?? 0;
    const trimEnd = track.trimEnd ?? duration;
    const clipW = (trimEnd - trimStart) * pxPerSec;
    const trimStartX = clipX;
    const trimEndX = clipX + clipW;

    // クリップ背景
    ctx.fillStyle = track.color + "18";
    ctx.beginPath();
    ctx.roundRect(trimStartX, 2, clipW, H - 4, 4);
    ctx.fill();
    ctx.strokeStyle = track.color + "66";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(trimStartX, 2, clipW, H - 4, 4);
    ctx.stroke();

    // 波形
    const fullClipW = duration * pxPerSec;
    const samplesPerPx = waveform.length / fullClipW;
    const trimStartPx = trimStart * pxPerSec;

    if (samplesPerPx > 1) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(trimStartX, 0, clipW, H);
      ctx.clip();
      ctx.beginPath();
      const midY = H / 2;
      const ampScale = (H - 8) * 0.42;
      for (let px = 0; px < clipW; px++) {
        const srcPx = trimStartPx + px;
        const sStart = Math.floor(srcPx * samplesPerPx);
        const sEnd = Math.min(Math.ceil((srcPx + 1) * samplesPerPx), waveform.length);
        let max = 0;
        for (let s = sStart; s < sEnd; s++) { if (waveform[s] > max) max = waveform[s]; }
        const y = midY - max * ampScale;
        if (px === 0) ctx.moveTo(trimStartX + px, y); else ctx.lineTo(trimStartX + px, y);
      }
      for (let px = Math.floor(clipW) - 1; px >= 0; px--) {
        const srcPx = trimStartPx + px;
        const sStart = Math.floor(srcPx * samplesPerPx);
        const sEnd = Math.min(Math.ceil((srcPx + 1) * samplesPerPx), waveform.length);
        let max = 0;
        for (let s = sStart; s < sEnd; s++) { if (waveform[s] > max) max = waveform[s]; }
        ctx.lineTo(trimStartX + px, midY + max * ampScale);
      }
      ctx.closePath();
      ctx.fillStyle = track.color + "bb";
      ctx.fill();
      ctx.strokeStyle = track.color;
      ctx.lineWidth = 0.5;
      ctx.stroke();
      ctx.restore();
    } else {
      const pxPerSample = fullClipW / waveform.length;
      const barW = Math.max(1, pxPerSample - (pxPerSample > 3 ? 1 : 0));
      const midY = H / 2;
      const ampScale = (H - 8) * 0.42;
      const visStartSample = Math.max(0, Math.floor(trimStart * (waveform.length / duration)) - 2);
      const visEndSample = Math.min(waveform.length, Math.ceil(trimEnd * (waveform.length / duration)) + 2);
      ctx.save();
      ctx.beginPath();
      ctx.rect(trimStartX, 0, clipW, H);
      ctx.clip();
      ctx.fillStyle = track.color + "dd";
      for (let i = visStartSample; i < visEndSample; i++) {
        const amp = waveform[i];
        const barH = amp * ampScale * 2;
        const x = clipX + i * pxPerSample;
        ctx.fillRect(x, midY - barH / 2, barW, barH);
      }
      ctx.restore();
    }

    // トラック名・BPM
    ctx.fillStyle = track.color + "99";
    ctx.font = "bold 9px Space Grotesk, sans-serif";
    ctx.fillText(track.name, trimStartX + 6, H - 6);
    if (track.bpm) {
      ctx.fillStyle = track.color;
      ctx.font = "bold 9px JetBrains Mono, monospace";
      ctx.fillText(`${track.bpm}`, trimStartX + 6, 14);
    }

    // フェードイン
    const fadeIn = track.fadeIn ?? 0;
    if (fadeIn > 0) {
      const fadeInPx = Math.min(fadeIn * pxPerSec, clipW);
      const grad = ctx.createLinearGradient(trimStartX, 0, trimStartX + fadeInPx, 0);
      grad.addColorStop(0, "#0d0d14ee");
      grad.addColorStop(1, "rgba(13,13,20,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.rect(trimStartX, 2, fadeInPx, H - 4);
      ctx.fill();
      ctx.strokeStyle = track.color + "88";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(trimStartX, H - 4);
      ctx.lineTo(trimStartX + fadeInPx, 2);
      ctx.stroke();
      ctx.fillStyle = track.color;
      ctx.beginPath();
      ctx.moveTo(trimStartX, 2);
      ctx.lineTo(trimStartX + 14, 2);
      ctx.lineTo(trimStartX, 16);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillStyle = track.color + "55";
      ctx.beginPath();
      ctx.moveTo(trimStartX, 2);
      ctx.lineTo(trimStartX + 10, 2);
      ctx.lineTo(trimStartX, 12);
      ctx.closePath();
      ctx.fill();
    }

    // フェードアウト
    const fadeOut = track.fadeOut ?? 0;
    if (fadeOut > 0) {
      const fadeOutPx = Math.min(fadeOut * pxPerSec, clipW);
      const grad = ctx.createLinearGradient(trimEndX - fadeOutPx, 0, trimEndX, 0);
      grad.addColorStop(0, "rgba(13,13,20,0)");
      grad.addColorStop(1, "#0d0d14ee");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.rect(trimEndX - fadeOutPx, 2, fadeOutPx, H - 4);
      ctx.fill();
      ctx.strokeStyle = track.color + "88";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(trimEndX - fadeOutPx, 2);
      ctx.lineTo(trimEndX, H - 4);
      ctx.stroke();
      ctx.fillStyle = track.color;
      ctx.beginPath();
      ctx.moveTo(trimEndX, 2);
      ctx.lineTo(trimEndX - 14, 2);
      ctx.lineTo(trimEndX, 16);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillStyle = track.color + "55";
      ctx.beginPath();
      ctx.moveTo(trimEndX, 2);
      ctx.lineTo(trimEndX - 10, 2);
      ctx.lineTo(trimEndX, 12);
      ctx.closePath();
      ctx.fill();
    }

    // リサイズハンドル
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(trimStartX - 1, 0, 2, H);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(trimEndX - 1, 0, 2, H);
    ctx.fillStyle = track.color + "cc";
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(trimEndX - 8 + i * 3, H / 2 - 8, 1.5, 16);
    }
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(trimStartX + 2 + i * 3, H / 2 - 8, 1.5, 16);
    }

    // BPMグリッド
    if (showGridRef.current && masterBpmRef.current > 0) {
      const bpm = masterBpmRef.current;
      const beatPx = (60 / bpm) * pxPerSec;
      ctx.save();
      ctx.beginPath();
      ctx.rect(trimStartX, 0, clipW, H);
      ctx.clip();
      const firstBeat = Math.floor(clipX / beatPx) * beatPx;
      let x = firstBeat;
      while (x <= trimEndX + 1) {
        if (x >= trimStartX - 1) {
          const beatIndex = Math.round(x / beatPx);
          const isBar8 = beatIndex % 8 === 0;
          const isBar4 = beatIndex % 4 === 0;
          if (isBar8) {
            ctx.strokeStyle = "rgba(168,255,62,0.45)";
            ctx.lineWidth = 1.5;
          } else if (isBar4) {
            ctx.strokeStyle = "rgba(168,255,62,0.18)";
            ctx.lineWidth = 1;
          } else {
            ctx.strokeStyle = "rgba(168,255,62,0.06)";
            ctx.lineWidth = 0.8;
          }
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, H);
          ctx.stroke();
        }
        x += beatPx;
      }
      ctx.restore();
    }

    return track.isAnalyzing ?? false;
  }, []);

  // ── drawRuler ──
  const drawRuler = useCallback((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    const pxPerSec = pxPerSecRef.current;
    const maxDuration = maxDurationRef.current;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#0a0a0f";
    ctx.fillRect(0, 0, W, H);

    // グリッドはCSSオーバーレイ(GridOverlay)で描画 — ここはタイムラベルのみ
    const stepSec = pxPerSec > 120 ? 1 : pxPerSec > 60 ? 2 : pxPerSec > 30 ? 4 : 8;

    ctx.font = "9px JetBrains Mono, monospace";
    let t = 0;
    while (t <= maxDuration + stepSec) {
      const x = t * pxPerSec;
      ctx.fillStyle = "#555566";
      ctx.fillRect(x, H - 8, 1, 8);
      if (t % (stepSec * 2) === 0 || stepSec <= 2) {
        ctx.fillStyle = "#888899";
        ctx.fillText(formatTime(t), x + 2, H - 10);
      }
      t += stepSec;
    }
  }, []);

  // Canvas resize
  useEffect(() => {
    tracks.forEach((t) => {
      const canvas = canvasRefs.current.get(t.id);
      if (canvas && canvas.width !== canvasWidth) {
        canvas.width = canvasWidth;
        needsWaveRedraw.current = true;
      }
    });
    const ruler = document.getElementById("groova-ruler") as HTMLCanvasElement;
    if (ruler && ruler.width !== canvasWidth) {
      ruler.width = canvasWidth;
      needsRulerRedraw.current = true;
    }
  }, [tracks.length, canvasWidth]);

  // ── rAF loop ──
  useEffect(() => {
    let lastStoreWrite = 0;
    const loop = () => {
      const phTime = audioEngine.getCurrentTime();
      playheadTimeRef.current = phTime;

      if (playheadLineRef.current) {
        const x = phTime * pxPerSecRef.current;
        playheadLineRef.current.style.transform = `translateX(${x}px)`;
      }

      const now = performance.now();
      if (now - lastStoreWrite > 250) {
        setPlayheadTime(phTime);
        lastStoreWrite = now;
      }

      const hasAnalyzing = tracksRef.current.some((t) => t.isAnalyzing);
      if (hasAnalyzing) needsWaveRedraw.current = true;

      if (needsWaveRedraw.current) {
        // rowId グループごとにまとめて描画
        const allTracks = tracksRef.current;
        const rowMap = new Map<string, TrackState[]>();
        for (const t of allTracks) {
          const rid = t.rowId ?? t.id;
          if (!rowMap.has(rid)) rowMap.set(rid, []);
          rowMap.get(rid)!.push(t);
        }
        rowMap.forEach((rowTracks) => drawRowTracks(rowTracks));
        needsWaveRedraw.current = false;
      }
      if (needsRulerRedraw.current) {
        const rulerCanvas = document.getElementById("groova-ruler") as HTMLCanvasElement;
        if (rulerCanvas) drawRuler(rulerCanvas);
        needsRulerRedraw.current = false;
      }

      if (scrollRef.current) {
        const container = scrollRef.current;
        if (isPlayingRef.current && !isDraggingPlayhead.current) {
          const phX = phTime * pxPerSecRef.current;
          const viewLeft = container.scrollLeft;
          const viewW = container.clientWidth;
          if (phX > viewLeft + viewW * 0.75 || phX < viewLeft) {
            scrollTargetRef.current = Math.max(0, phX - viewW * 0.25);
          }
        }
        if (scrollTargetRef.current !== null) {
          const cur = container.scrollLeft;
          const diff = scrollTargetRef.current - cur;
          if (Math.abs(diff) < 0.5) {
            container.scrollLeft = scrollTargetRef.current;
            scrollTargetRef.current = null;
          } else {
            container.scrollLeft = cur + diff * 0.14;
          }
        }
      }

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [drawTrack, drawRuler]);

  // ── ルーラー drag ──
  const handleRulerPointerDown = (e: React.PointerEvent) => {
    isDraggingPlayhead.current = true;
    scrollTargetRef.current = null;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft || 0);
    const t = Math.max(0, x / pxPerSecRef.current);
    playheadTimeRef.current = t;
    setPlayheadTime(t);
    audioEngine.seekTo?.(t);
  };
  const handleRulerPointerMove = (e: React.PointerEvent) => {
    if (!isDraggingPlayhead.current) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft || 0);
    const t = Math.max(0, x / pxPerSecRef.current);
    playheadTimeRef.current = t;
    setPlayheadTime(t);
    audioEngine.seekTo?.(t);
  };
  const handleRulerPointerUp = () => { isDraggingPlayhead.current = false; };

  // ── ヒットテスト: クリック位置からトラック上のどの部分かを判定 ──
  const hitTest = useCallback((e: React.PointerEvent, trackId: string): {
    zone: "trim-left" | "trim-right" | "fade-in" | "fade-out" | "body" | "none";
    timeInClip: number;
    timeOnTimeline: number;
  } => {
    const canvas = canvasRefs.current.get(trackId);
    if (!canvas) return { zone: "none", timeInClip: 0, timeOnTimeline: 0 };
    const rect = canvas.getBoundingClientRect();
    const canvasX = e.clientX - rect.left + (scrollRef.current?.scrollLeft || 0);
    const canvasY = e.clientY - rect.top;

    const track = tracksRef.current.find((t) => t.id === trackId);
    if (!track?.audioBuffer) return { zone: "none", timeInClip: 0, timeOnTimeline: 0 };

    const pxPerSec = pxPerSecRef.current;
    const offset = trackOffsetsRef.current[trackId] || 0;
    const duration = track.audioBuffer.duration;
    const trimStart = track.trimStart ?? 0;
    const trimEnd = track.trimEnd ?? duration;
    const clipW = (trimEnd - trimStart) * pxPerSec;
    const clipX = offset * pxPerSec; // trimStart side in canvas coords
    const clipEndX = clipX + clipW;

    const timeOnTimeline = canvasX / pxPerSec;
    const timeInClip = timeOnTimeline - offset;

    const HANDLE_PX = 16; // ハンドル検出幅

    // 右端リサイズゾーン
    if (Math.abs(canvasX - clipEndX) < HANDLE_PX) return { zone: "trim-right", timeInClip, timeOnTimeline };
    // 左端リサイズゾーン
    if (Math.abs(canvasX - clipX) < HANDLE_PX) return { zone: "trim-left", timeInClip, timeOnTimeline };
    // フェードインハンドル（左上三角）
    if (canvasY < 20 && canvasX >= clipX && canvasX < clipX + HANDLE_PX * 2) return { zone: "fade-in", timeInClip, timeOnTimeline };
    // フェードアウトハンドル（右上三角）
    if (canvasY < 20 && canvasX <= clipEndX && canvasX > clipEndX - HANDLE_PX * 2) return { zone: "fade-out", timeInClip, timeOnTimeline };
    // クリップ内
    if (canvasX >= clipX && canvasX <= clipEndX) return { zone: "body", timeInClip, timeOnTimeline };
    return { zone: "none", timeInClip, timeOnTimeline };
  }, []);

  // ── カーソルスタイル決定 ──
  const getCursor = useCallback((zone: string): string => {
    const tool = editToolRef.current;
    if (tool === "split") return "crosshair";
    if (tool === "fade") return "ns-resize";
    if (zone === "trim-left" || zone === "trim-right") return "col-resize";
    if (zone === "fade-in" || zone === "fade-out") return "ew-resize";
    return "grab";
  }, []);

  // ── hitTestRow: rowの全クリップからポインター位置に一番近いクリップIDを返す ──
  const hitTestRow = useCallback((e: React.PointerEvent | React.DragEvent, rowTracks: TrackState[]): string | null => {
    const rowKey = rowTracks[0]?.rowId ?? rowTracks[0]?.id;
    const canvas = rowKey ? canvasRefs.current.get(rowKey) : null;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const clientX = (e as React.PointerEvent).clientX ?? (e as React.DragEvent).clientX;
    const canvasX = clientX - rect.left + (scrollRef.current?.scrollLeft || 0);
    const pxPerSec = pxPerSecRef.current;

    for (const t of rowTracks) {
      if (!t.audioBuffer) continue;
      const offset = trackOffsetsRef.current[t.id] || 0;
      const trimStart = t.trimStart ?? 0;
      const trimEnd = t.trimEnd ?? t.audioBuffer.duration;
      const clipX = offset * pxPerSec;
      const clipEndX = clipX + (trimEnd - trimStart) * pxPerSec;
      if (canvasX >= clipX - 16 && canvasX <= clipEndX + 16) return t.id;
    }
    // フォールバック: 音声ありの先頭クリップ
    return rowTracks.find((t) => t.audioBuffer)?.id ?? rowTracks[0]?.id ?? null;
  }, []);

  // ── Track PointerDown ──
  const handleTrackPointerDown = useCallback((e: React.PointerEvent, trackId: string) => {
    e.stopPropagation();
    const track = tracksRef.current.find((t) => t.id === trackId);
    if (!track?.audioBuffer) return;

    const { zone, timeOnTimeline, timeInClip } = hitTest(e, trackId);
    const tool = editToolRef.current;

    // ── 分割 ──
    if (tool === "split" && zone === "body") {
      const duration = track.audioBuffer.duration;
      const trimStart = track.trimStart ?? 0;
      const trimEnd = track.trimEnd ?? duration;
      const splitAt = trimStart + timeInClip; // seconds in audio file
      if (splitAt <= trimStart + 0.1 || splitAt >= trimEnd - 0.1) return;

      const origOffset = trackOffsetsRef.current[trackId] || 0;
      const origTrimEnd = track.trimEnd ?? duration;

      // 既存クリップを前半に
      useGROOVA.getState().updateTrack(trackId, { trimEnd: splitAt, fadeOut: 0 });

      // 後半クリップを新規トラックとして追加
      const { addTrack, updateTrack } = useGROOVA.getState();
      addTrack();
      const newTracks = useGROOVA.getState().tracks;
      const newTrack = newTracks[newTracks.length - 1];
      if (newTrack) {
        updateTrack(newTrack.id, {
          name: track.name + " [2]",
          file: track.file,
          audioBuffer: track.audioBuffer,
          bpm: track.bpm,
          bpmConfidence: track.bpmConfidence,
          waveformData: track.waveformData,
          beatPositions: track.beatPositions,
          color: track.color,
          trimStart: splitAt,
          trimEnd: origTrimEnd,
          fadeIn: 0,
          fadeOut: track.fadeOut ?? 0,
          speed: track.speed,
          volume: track.volume,
        });
        // 後半クリップのタイムライン位置 = 元offset + (splitAt - trimStart)
        // これで前半の終端と後半の先端がぴったり連続する
        const newOffset = origOffset + (splitAt - trimStart);
        setTrackOffsets((prev) => ({ ...prev, [newTrack.id]: newOffset }));
      }
      needsWaveRedraw.current = true;
      return;
    }

    // ── リサイズ（trim） ──
    if (zone === "trim-right" || zone === "trim-left") {
      const duration = track.audioBuffer.duration;
      isTrimming.current = {
        id: trackId,
        side: zone === "trim-right" ? "right" : "left",
        startX: e.clientX,
        origTrimStart: track.trimStart ?? 0,
        origTrimEnd: track.trimEnd ?? duration,
        origOffset: trackOffsetsRef.current[trackId] || 0,
        duration,
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    // ── フェード ──
    if (zone === "fade-in" || zone === "fade-out") {
      const duration = track.audioBuffer.duration;
      const trimEnd = track.trimEnd ?? duration;
      const trimStart = track.trimStart ?? 0;
      isFading.current = {
        id: trackId,
        side: zone === "fade-in" ? "in" : "out",
        startX: e.clientX,
        origFade: zone === "fade-in" ? (track.fadeIn ?? 0) : (track.fadeOut ?? 0),
        duration: trimEnd - trimStart,
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    // ── 通常移動 ──
    if (zone === "body") {
      isDraggingTrack.current = {
        id: trackId,
        startX: e.clientX,
        origOffset: trackOffsetsRef.current[trackId] || 0,
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
  }, [hitTest]);

  // ── Track PointerMove ──
  const handleTrackPointerMove = useCallback((e: React.PointerEvent) => {
    // trimming
    if (isTrimming.current) {
      const { id, side, startX, origTrimStart, origTrimEnd, origOffset, duration } = isTrimming.current;
      const dx = (e.clientX - startX) / pxPerSecRef.current;
      const store = useGROOVA.getState();
      if (side === "right") {
        const newEnd = Math.min(duration, Math.max(origTrimStart + 0.1, origTrimEnd + dx));
        store.updateTrack(id, { trimEnd: newEnd });
      } else {
        const newStart = Math.max(0, Math.min(origTrimEnd - 0.1, origTrimStart + dx));
        const newOffset = Math.max(0, origOffset + dx);
        store.updateTrack(id, { trimStart: newStart });
        // trim ドラッグ中も ref のみ更新 → pointerUp で store へ
        trackOffsetsRef.current = { ...trackOffsetsRef.current, [id]: newOffset };
      }
      needsWaveRedraw.current = true;
      return;
    }

    // fading
    if (isFading.current) {
      const { id, side, startX, origFade, duration } = isFading.current;
      const dx = (e.clientX - startX) / pxPerSecRef.current;
      const newFade = Math.max(0, Math.min(duration * 0.9, origFade + (side === "in" ? dx : -dx)));
      const store = useGROOVA.getState();
      if (side === "in") {
        store.updateTrack(id, { fadeIn: newFade });
      } else {
        store.updateTrack(id, { fadeOut: newFade });
      }
      needsWaveRedraw.current = true;
      return;
    }

    // move
    if (isDraggingTrack.current) {
      const { id, startX, origOffset } = isDraggingTrack.current;
      const dx = e.clientX - startX;
      const newOffset = Math.max(0, origOffset + dx / pxPerSecRef.current);
      // ドラッグ中は ref のみ更新（store への書き込みは pointerUp で行う）
      trackOffsetsRef.current = { ...trackOffsetsRef.current, [id]: newOffset };
      needsWaveRedraw.current = true;
    }
  }, []);

  // ── Track PointerUp ──
  const handleTrackPointerUp = useCallback(() => {
    // trim-left 確定 → store に offset 反映
    if (isTrimming.current && isTrimming.current.side === "left") {
      const { id } = isTrimming.current;
      const finalOffset = trackOffsetsRef.current[id] ?? 0;
      setTrackOffset(id, finalOffset);
    }
    isTrimming.current = null;
    isFading.current = null;
    // move ドラッグ確定 → store に反映
    if (isDraggingTrack.current) {
      const { id } = isDraggingTrack.current;
      const finalOffset = trackOffsetsRef.current[id] ?? 0;
      setTrackOffset(id, finalOffset);
    }
    isDraggingTrack.current = null;
  }, [setTrackOffset]);

  // ── カーソル更新（hover） ──
  const handleTrackPointerHover = useCallback((e: React.PointerEvent, trackId: string) => {
    if (isTrimming.current || isFading.current || isDraggingTrack.current) return;
    const { zone } = hitTest(e, trackId);
    const canvas = canvasRefs.current.get(trackId);
    if (canvas) canvas.style.cursor = getCursor(zone);
  }, [hitTest, getCursor]);

  // Pinch zoom
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchRef.current = { dist: Math.hypot(dx, dy), zoom: zoomLevel };
    }
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchRef.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const ratio = Math.hypot(dx, dy) / pinchRef.current.dist;
      useGROOVA.getState().setZoom(Math.max(0.25, Math.min(64, pinchRef.current.zoom * ratio)));
    }
  };

  const handleFileDrop = async (e: React.DragEvent, trackId: string) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file, trackId);
  };

  const loadFile = async (file: File, trackId: string) => {
    updateTrack(trackId, { file, isAnalyzing: true, bpm: null, waveformData: null });
    try {
      const ctx = await audioEngine.ensureRunning();
      const audioBuffer = await decodeAudioFile(file, ctx);
      const waveformSamples = Math.min(audioBuffer.length, Math.max(50000, Math.ceil(audioBuffer.sampleRate * audioBuffer.duration / 4)));
      const waveformData = extractWaveform(audioBuffer, waveformSamples);
      updateTrack(trackId, { audioBuffer, waveformData });
      const result = await analyzeBPM(audioBuffer);
      updateTrack(trackId, {
        bpm: result.bpm,
        bpmConfidence: result.confidence,
        beatPositions: result.beatPositions,
        isAnalyzing: false,
      });
      const { tracks: cur } = useGROOVA.getState();
      if (!cur.find((t) => t.id !== trackId && t.bpm)) setMasterBpm(result.bpm);
    } catch (err) {
      console.error(err);
      updateTrack(trackId, { isAnalyzing: false });
    }
  };

  const handleDeleteTrack = (trackId: string) => {
    canvasRefs.current.delete(trackId);
    // store の trackOffsets から削除（-1 で無効化 → storeTrackOffsets を読む側でフィルタ）
    // setTrackOffset はないので store を直接更新
    useGROOVA.setState((s) => {
      const n = { ...s.trackOffsets };
      delete n[trackId];
      return { trackOffsets: n };
    });
    removeTrack(trackId);
  };

  return (
    <div
      style={{ background: "#0a0a0f", borderTop: "1px solid #1a1a24", flex: 1, minHeight: 0, overflow: "hidden", position: "relative" }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
    >

      <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
        {/* 左: ラベル列 */}
        <div style={{
          width: LABEL_WIDTH, flexShrink: 0,
          display: "flex", flexDirection: "column",
          borderRight: "1px solid #1a1a24", background: "#0c0c14", zIndex: 5,
        }}>
          {/* ツールバー */}
          <div style={{
            height: RULER_HEIGHT, flexShrink: 0,
            borderBottom: "1px solid #1a1a24",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
            background: "#0a0a0f", padding: "0 4px",
          }}>
            {([
              { tool: "move" as EditTool, icon: "⇄", title: "移動" },
              { tool: "split" as EditTool, icon: "✂", title: "分割" },
              { tool: "trim" as EditTool, icon: "⟷", title: "リサイズ" },
              { tool: "fade" as EditTool, icon: "∿", title: "フェード" },
            ]).map(({ tool, icon, title }) => (
              <button
                key={tool}
                title={title}
                onClick={() => setEditTool(tool)}
                style={{
                  width: 22, height: 22, borderRadius: 5,
                  background: editTool === tool ? "#a8ff3e22" : "transparent",
                  border: `1px solid ${editTool === tool ? "#a8ff3e66" : "#2a2a3a"}`,
                  color: editTool === tool ? "#a8ff3e" : "#555566",
                  fontSize: 11, cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  touchAction: "manipulation",
                }}
              >{icon}</button>
            ))}
          </div>
          <div style={{ flex: 1, overflowY: "hidden" }}>
            {/* rowId ごとに1行だけラベルを表示 */}
            {rowRepresentatives.map((track) => (
              <TrackLabel
                key={track.rowId ?? track.id}
                track={track}
                onDelete={() => {
                  // 同じ rowId のクリップを全削除
                  const rid = track.rowId ?? track.id;
                  const same = useGROOVA.getState().tracks.filter((t) => (t.rowId ?? t.id) === rid);
                  same.forEach((t) => handleDeleteTrack(t.id));
                }}
                onFileSelect={(file) => loadFile(file, track.id)}
              />
            ))}
            {rows.length < 6 && (
              <div style={{
                height: TRACK_HEIGHT, borderTop: "1px solid #1a1a24",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <button onClick={addTrack} style={{
                  width: 24, height: 24, borderRadius: 999,
                  background: "#1a1a24", border: "1px solid #2a2a3a",
                  color: "#a8ff3e", fontSize: 16,
                  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                }}>+</button>
              </div>
            )}
          </div>
        </div>

        {/* 右: スクロール領域 */}
        <div
          ref={scrollRef}
          onScroll={() => { if (!isPlayingRef.current) scrollTargetRef.current = null; }}
          style={{
            flex: 1, overflowX: "auto", overflowY: "hidden",
            scrollbarWidth: "thin", scrollbarColor: "#252535 #0a0a0f",
            position: "relative", touchAction: "pan-x",
          }}
        >
          <div style={{ width: canvasWidth, position: "relative", minHeight: "100%" }}>

            {/* ルーラー */}
            <div style={{ height: RULER_HEIGHT, position: "relative", flexShrink: 0 }}>
              <canvas
                id="groova-ruler"
                width={canvasWidth}
                height={RULER_HEIGHT}
                style={{ display: "block" }}
              />
              <div
                ref={rulerDragRef}
                style={{ position: "absolute", inset: 0, cursor: "col-resize", touchAction: "none" }}
                onPointerDown={handleRulerPointerDown}
                onPointerMove={handleRulerPointerMove}
                onPointerUp={handleRulerPointerUp}
              />
            </div>

            {/* Tracks — rowId ごとに1行のCanvas。同行の全クリップを描画 */}
            {rows.map((rowTracks) => {
              const rep = rowTracks[0];
              const rowKey = rep.rowId ?? rep.id;
              return (
                <TrackCanvas
                  key={rowKey}
                  track={rep}
                  editTool={editTool}
                  canvasWidth={canvasWidth}
                  canvasRefs={canvasRefs}
                  onPointerDown={(e) => {
                    const hitId = hitTestRow(e, rowTracks);
                    handleTrackPointerDown(e, hitId ?? rep.id);
                  }}
                  onPointerMove={(e) => {
                    handleTrackPointerMove(e);
                    const hitId = hitTestRow(e, rowTracks);
                    handleTrackPointerHover(e, hitId ?? rep.id);
                  }}
                  onPointerUp={handleTrackPointerUp}
                  onDrop={(e) => {
                    const hitId = hitTestRow(e, rowTracks);
                    handleFileDrop(e, hitId ?? rep.id);
                  }}
                  onFileSelect={(file) => loadFile(file, rep.id)}
                />
              );
            })}

            {rows.length < 6 && (
              <div style={{ height: TRACK_HEIGHT, borderTop: "1px solid #1a1a24", background: "#080810" }} />
            )}

            {/* プレイヘッド */}
            <div
              ref={playheadLineRef}
              style={{
                position: "absolute", top: 0, left: 0,
                width: 2, height: "100%",
                background: "rgba(255,80,80,0.85)",
                pointerEvents: "none", zIndex: 20,
                willChange: "transform",
              }}
            >
              {/* Filmoraスタイル: ハサミ丸ボタン */}
              {onSplitAtPlayhead && (
                <button
                  onClick={(e) => { e.stopPropagation(); onSplitAtPlayhead(playheadTimeRef.current); }}
                  onPointerDown={(e) => e.stopPropagation()}
                  style={{
                    position: "absolute",
                    top: RULER_HEIGHT - 2,
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: 28, height: 28, borderRadius: "50%",
                    background: "linear-gradient(135deg, #ff4040, #cc2020)",
                    border: "2px solid rgba(255,255,255,0.3)",
                    color: "#fff",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer",
                    pointerEvents: "auto",
                    zIndex: 21,
                    boxShadow: "0 2px 8px rgba(255,60,60,0.6)",
                    touchAction: "manipulation",
                    WebkitTapHighlightColor: "transparent",
                  }}
                >
                  <Scissors size={12} />
                </button>
              )}
              {/* ルーラーヘッド三角 */}
              <div style={{
                position: "absolute", top: 0, left: -5,
                width: 12, height: 12,
                background: "rgba(255,80,80,0.9)",
                clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
              }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── ラベル列 ──
function TrackLabel({ track, onDelete, onFileSelect }: {
  track: TrackState;
  onDelete: () => void;
  onFileSelect: (file: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { updateTrack } = useGROOVA();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDeleteTap = () => {
    if (confirmDelete) {
      onDelete();
    } else {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 2000);
    }
  };

  return (
    <div style={{
      height: TRACK_HEIGHT, borderTop: "1px solid #1a1a24",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      gap: 3, padding: "4px 2px",
    }}>
      <div style={{ width: 7, height: 7, borderRadius: "50%", background: track.color, boxShadow: `0 0 6px ${track.color}`, flexShrink: 0 }} />
      <button
        onClick={() => updateTrack(track.id, { muted: !track.muted })}
        style={{
          fontSize: 7, padding: "1px 3px", borderRadius: 3,
          background: track.muted ? "#ff6b2b22" : "#1a1a24",
          border: `1px solid ${track.muted ? "#ff6b2b44" : "#2a2a3a"}`,
          color: track.muted ? "#ff6b2b" : "#4a4a5a",
          cursor: "pointer", lineHeight: 1.4,
        }}
      >M</button>
      <button
        onClick={() => { audioEngine.unlockContext(); fileRef.current?.click(); }}
        style={{ fontSize: 13, background: "none", border: "none", color: track.audioBuffer ? track.color : "#2a2a3a", cursor: "pointer", padding: 0, lineHeight: 1 }}
        title="曲を追加"
      >{track.audioBuffer ? "♪" : "+"}</button>
      <input ref={fileRef} type="file" accept="audio/*,.mp3,.m4a,.wav,.flac,.ogg,.aac" style={{ display: "none" }}
        onChange={(e) => e.target.files?.[0] && onFileSelect(e.target.files[0])} />
      {track.audioBuffer && (
        <button
          onClick={handleDeleteTap}
          title={confirmDelete ? "もう一度タップで削除" : "音源を削除"}
          style={{
            fontSize: 9, padding: "1px 3px", borderRadius: 3,
            background: confirmDelete ? "#ff000033" : "#1a1a24",
            border: `1px solid ${confirmDelete ? "#ff0000aa" : "#2a2a3a"}`,
            color: confirmDelete ? "#ff4444" : "#4a4a5a",
            cursor: "pointer", lineHeight: 1.4, transition: "all 0.15s",
          }}
        >{confirmDelete ? "確認" : "削除"}</button>
      )}
    </div>
  );
}

// ── Canvas列 ──
function TrackCanvas({ track, editTool, canvasWidth, canvasRefs, onPointerDown, onPointerMove, onPointerUp, onDrop, onFileSelect }: {
  track: TrackState;
  editTool: EditTool;
  canvasWidth: number;
  canvasRefs: React.MutableRefObject<Map<string, HTMLCanvasElement>>;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onFileSelect: (file: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  const cursorMap: Record<EditTool, string> = {
    move: track.audioBuffer ? "grab" : "default",
    split: track.audioBuffer ? "crosshair" : "default",
    trim: track.audioBuffer ? "col-resize" : "default",
    fade: track.audioBuffer ? "ew-resize" : "default",
  };

  return (
    <div style={{ height: TRACK_HEIGHT, borderTop: "1px solid #1a1a24", position: "relative" }}>
      <canvas
        ref={(el) => {
          if (el) {
            const key = track.rowId ?? track.id;
            const isNew = !canvasRefs.current.get(key);
            canvasRefs.current.set(key, el);
            if (isNew) { el.width = canvasWidth; el.height = TRACK_HEIGHT; }
          }
        }}
        style={{
          width: "100%", height: "100%", display: "block",
          touchAction: track.audioBuffer ? "none" : "pan-x",
          cursor: cursorMap[editTool],
          pointerEvents: track.audioBuffer ? "auto" : "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      />

      {!track.audioBuffer && !track.isAnalyzing && (
        <button
          onClick={(e) => { e.stopPropagation(); audioEngine.unlockContext(); fileRef.current?.click(); }}
          style={{
            position: "absolute", inset: 0, width: "100%", height: "100%",
            background: "transparent", border: "none", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "flex-start",
            paddingLeft: 16, gap: 8, color: "#4a4a6a", zIndex: 2,
          }}
        >
          <span style={{ width: 28, height: 28, borderRadius: "50%", border: "1.5px dashed #3a3a5a", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, lineHeight: 1, color: "#5a5a7a", flexShrink: 0 }}>+</span>
          <span style={{ fontSize: 12, letterSpacing: "0.02em" }}>音源を読み込む</span>
        </button>
      )}
      <input ref={fileRef} type="file" accept="audio/*,.mp3,.m4a,.wav,.flac,.ogg,.aac" style={{ display: "none" }}
        onChange={(e) => e.target.files?.[0] && onFileSelect(e.target.files[0])} />

      {track.isAnalyzing && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", paddingLeft: 16, gap: 8, color: track.color, fontSize: 12 }}>
          <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span>
          解析中…
        </div>
      )}
    </div>
  );
}
