import { useRef, useEffect, useCallback, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useGROOVA, TrackState } from "../lib/store";
import { analyzeBPM, decodeAudioFile, extractWaveform } from "../lib/bpmAnalyzer";
import { audioEngine } from "../lib/audioEngine";

const TRACK_HEIGHT = 76;
const RULER_HEIGHT = 32;
const LABEL_WIDTH = 52;
const PIXELS_PER_SEC_BASE = 80;

function BpmToast({ bpm, trackName, color, onDone }: {
  bpm: number; trackName: string; color: string; onDone: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onDone, 2500);
    return () => clearTimeout(timer);
  }, [onDone]);
  return (
    <motion.div
      initial={{ opacity: 0, y: -30, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.9 }}
      transition={{ type: "spring", damping: 20, stiffness: 300 }}
      style={{
        position: "absolute", top: 8, left: "50%", transform: "translateX(-50%)",
        zIndex: 100, background: "#111118ee", border: `1.5px solid ${color}66`,
        borderRadius: 12, padding: "8px 16px", display: "flex", alignItems: "center",
        gap: 10, backdropFilter: "blur(8px)", boxShadow: `0 4px 20px ${color}22`,
      }}
    >
      <span style={{ fontFamily: "JetBrains Mono, monospace", fontWeight: 800, fontSize: 28, color, textShadow: `0 0 20px ${color}88`, lineHeight: 1 }}>
        {bpm}
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <span style={{ fontSize: 10, color: "#888899", fontFamily: "Space Grotesk, sans-serif", fontWeight: 600 }}>BPM 検出</span>
        <span style={{ fontSize: 11, color: "#ccccdd", fontFamily: "Space Grotesk, sans-serif", fontWeight: 500 }}>{trackName}</span>
      </div>
    </motion.div>
  );
}

function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 10);
  return `${m}:${String(s).padStart(2, "0")}.${ms}`;
}

export default function Timeline() {
  const {
    tracks, updateTrack, masterBpm, showGrid,
    setPlayheadTime, isPlaying, zoomLevel, addTrack, setMasterBpm,
    scrollResetCounter, removeTrack,
  } = useGROOVA();

  const scrollRef = useRef<HTMLDivElement>(null);
  const rulerDragRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  // プレイヘッドDOMを直接操作するためのref（Reactレンダリング外）
  const playheadLineRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>();
  const isDraggingPlayhead = useRef(false);
  const scrollTargetRef = useRef<number | null>(null);
  const isDraggingTrack = useRef<{ id: string; startX: number; origOffset: number } | null>(null);
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);
  // 波形再描画フラグ
  const needsWaveRedraw = useRef(true);
  const needsRulerRedraw = useRef(true);

  const [trackOffsets, setTrackOffsets] = useState<Record<string, number>>({});
  const [bpmToast, setBpmToast] = useState<{ bpm: number; trackName: string; color: string } | null>(null);
  const prevBpmRef = useRef<Record<string, number | null>>({});
  const pxPerSec = PIXELS_PER_SEC_BASE * zoomLevel;

  const topAudioTrack = tracks.find((t) => t.audioBuffer && t.beatPositions?.length > 0) ?? null;

  const maxDuration = Math.max(
    30,
    ...tracks.map((t) => {
      const dur = t.audioBuffer?.duration || 0;
      const off = trackOffsets[t.id] || 0;
      return off + dur;
    })
  );
  const canvasWidth = Math.max(maxDuration * pxPerSec + 200, 600);

  // スクロールリセット
  useEffect(() => {
    if (scrollResetCounter > 0 && scrollRef.current) {
      scrollTargetRef.current = null;
      scrollRef.current.scrollLeft = 0;
    }
  }, [scrollResetCounter]);

  // BPMトースト
  useEffect(() => {
    tracks.forEach((t) => {
      const prev = prevBpmRef.current[t.id];
      if ((prev === undefined || prev === null) && t.bpm && t.bpm > 0) {
        setBpmToast({ bpm: t.bpm, trackName: t.name, color: t.color });
      }
      prevBpmRef.current[t.id] = t.bpm;
    });
  }, [tracks]);

  // tracksやzoom等が変わったら波形再描画フラグを立てる
  useEffect(() => {
    needsWaveRedraw.current = true;
    needsRulerRedraw.current = true;
  }, [tracks, pxPerSec, trackOffsets, showGrid, masterBpm]);

  // refs for rAF（stateをrefで参照して再レンダリングを起こさない）
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

  // ── drawTrack（波形のみ・プレイヘッドなし） ──
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
      const clipW = duration * pxPerSec;

      ctx.fillStyle = track.color + "18";
      ctx.beginPath();
      ctx.roundRect(clipX, 2, clipW, H - 4, 4);
      ctx.fill();
      ctx.strokeStyle = track.color + "66";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(clipX, 2, clipW, H - 4, 4);
      ctx.stroke();

      const samplesPerPx = waveform.length / clipW;

      if (samplesPerPx > 1) {
        ctx.beginPath();
        const midY = H / 2;
        const ampScale = (H - 8) * 0.42;
        for (let px = 0; px < clipW; px++) {
          const sStart = Math.floor(px * samplesPerPx);
          const sEnd = Math.min(Math.ceil((px + 1) * samplesPerPx), waveform.length);
          let max = 0;
          for (let s = sStart; s < sEnd; s++) { if (waveform[s] > max) max = waveform[s]; }
          const y = midY - max * ampScale;
          if (px === 0) ctx.moveTo(clipX + px, y); else ctx.lineTo(clipX + px, y);
        }
        for (let px = Math.floor(clipW) - 1; px >= 0; px--) {
          const sStart = Math.floor(px * samplesPerPx);
          const sEnd = Math.min(Math.ceil((px + 1) * samplesPerPx), waveform.length);
          let max = 0;
          for (let s = sStart; s < sEnd; s++) { if (waveform[s] > max) max = waveform[s]; }
          ctx.lineTo(clipX + px, midY + max * ampScale);
        }
        ctx.closePath();
        ctx.fillStyle = track.color + "bb";
        ctx.fill();
        ctx.strokeStyle = track.color;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      } else {
        const pxPerSample = clipW / waveform.length;
        const barW = Math.max(1, pxPerSample - (pxPerSample > 3 ? 1 : 0));
        const scrollLeft = scrollRef.current?.scrollLeft || 0;
        const viewWidth = scrollRef.current?.clientWidth || clipW;
        const visStart = Math.max(0, Math.floor(((scrollLeft - clipX) / clipW) * waveform.length) - 2);
        const visEnd = Math.min(waveform.length, Math.ceil(((scrollLeft + viewWidth - clipX) / clipW) * waveform.length) + 2);
        ctx.fillStyle = track.color + "dd";
        const midY = H / 2;
        const ampScale = (H - 8) * 0.42;
        for (let i = visStart; i < visEnd; i++) {
          const amp = waveform[i];
          const barH = amp * ampScale * 2;
          ctx.fillRect(clipX + i * pxPerSample, midY - barH / 2, barW, barH);
        }
        ctx.strokeStyle = track.color + "44";
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(clipX, H / 2);
        ctx.lineTo(clipX + clipW, H / 2);
        ctx.stroke();
      }

      ctx.fillStyle = track.color + "99";
      ctx.font = "bold 9px Space Grotesk, sans-serif";
      ctx.fillText(track.name, clipX + 6, H - 6);

      if (track.bpm) {
        ctx.fillStyle = track.color;
        ctx.font = "bold 9px JetBrains Mono, monospace";
        ctx.fillText(`${track.bpm}`, clipX + 6, 14);
      }

      const trimStartX = clipX + (track.trimStart / duration) * clipW;
      const trimEndX = clipX + ((track.trimEnd || duration) / duration) * clipW;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(trimStartX - 1, 0, 2, H);
      ctx.beginPath(); ctx.moveTo(trimStartX, 2); ctx.lineTo(trimStartX + 10, 2); ctx.lineTo(trimStartX, 14); ctx.fill();
      ctx.fillRect(trimEndX - 1, 0, 2, H);
      ctx.beginPath(); ctx.moveTo(trimEndX, 2); ctx.lineTo(trimEndX - 10, 2); ctx.lineTo(trimEndX, 14); ctx.fill();

      // 8カウントマーカー
      if (showGridRef.current) {
        const top = topAudioTrackRef.current;
        if (top && top.id === track.id && top.beatPositions?.length > 0) {
          const beats = top.beatPositions;
          const topOffset = trackOffsetsRef.current[top.id] || 0;
          beats.forEach((beatTime, i) => {
            if (i % 8 !== 0) return;
            const countNum = Math.floor(i / 8) + 1;
            const bx = (topOffset + beatTime) * pxPerSec;
            if (bx < 0 || bx > W) return;
            ctx.strokeStyle = "#a8ff3ecc";
            ctx.lineWidth = 1.5;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(bx, 0);
            ctx.lineTo(bx, H);
            ctx.stroke();
            ctx.fillStyle = "#a8ff3e";
            ctx.beginPath();
            ctx.moveTo(bx - 5, 0);
            ctx.lineTo(bx + 5, 0);
            ctx.lineTo(bx, 8);
            ctx.closePath();
            ctx.fill();
            ctx.fillStyle = "#a8ff3e";
            ctx.font = "bold 8px JetBrains Mono, monospace";
            ctx.fillText(String(countNum), bx + 3, 20);
          });
        }
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

    // 解析アニメ（これだけはrAFで毎フレーム更新が必要）
    if (track.isAnalyzing) {
      const scanX = ((Date.now() % 2000) / 2000) * W;
      const grad = ctx.createLinearGradient(scanX - 40, 0, scanX + 40, 0);
      grad.addColorStop(0, "rgba(0,245,255,0)");
      grad.addColorStop(0.5, "rgba(0,245,255,0.7)");
      grad.addColorStop(1, "rgba(0,245,255,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(scanX - 40, 0, 80, H);
      return true; // 解析中は毎フレーム再描画が必要
    }
    return false;
  }, []); // deps なし — すべて ref 経由

  // ── drawRuler（プレイヘッドなし） ──
  const drawRuler = useCallback((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    const pxPerSec = pxPerSecRef.current;
    const maxDuration = maxDurationRef.current;
    const masterBpm = masterBpmRef.current;
    const showGrid = showGridRef.current;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#0a0a0f";
    ctx.fillRect(0, 0, W, H);

    const stepSec = pxPerSec > 120 ? 1 : pxPerSec > 60 ? 2 : pxPerSec > 30 ? 4 : 8;
    const beatSec = 60 / masterBpm;

    if (showGrid) {
      let t = 0;
      let beatIdx = 0;
      while (t <= maxDuration) {
        const x = t * pxPerSec;
        const beat = beatIdx % 8;
        if (beat === 0) {
          ctx.strokeStyle = "rgba(168,255,62,0.5)";
          ctx.lineWidth = 1.5;
        } else if (beat === 4) {
          ctx.strokeStyle = "rgba(168,255,62,0.25)";
          ctx.lineWidth = 1;
        } else {
          ctx.strokeStyle = "rgba(168,255,62,0.08)";
          ctx.lineWidth = 0.5;
        }
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
        t += beatSec;
        beatIdx++;
      }
    }

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
  }, []); // deps なし

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

  // ── rAF loop: プレイヘッドDOM更新 + オートスクロール + 必要時のみ波形描画 ──
  useEffect(() => {
    let lastStoreWrite = 0;
    const loop = () => {
      // ① プレイヘッド位置を audioEngine から直接取得（storeを経由しない）
      const phTime = audioEngine.getCurrentTime();
      playheadTimeRef.current = phTime;

      // ② プレイヘッドDIVを transform で直接動かす（React再レンダリングなし）
      if (playheadLineRef.current) {
        const x = phTime * pxPerSecRef.current;
        playheadLineRef.current.style.transform = `translateX(${x}px)`;
      }

      // ② store.setPlayheadTime は250ms間隔で間引き（ExportPanelなど向け）
      const now = performance.now();
      if (now - lastStoreWrite > 250) {
        setPlayheadTime(phTime);
        lastStoreWrite = now;
      }

      // ③ 解析中トラックがあれば波形フラグを立てる
      const hasAnalyzing = tracksRef.current.some((t) => t.isAnalyzing);
      if (hasAnalyzing) needsWaveRedraw.current = true;

      // ④ 波形再描画（変化時のみ）
      if (needsWaveRedraw.current) {
        tracksRef.current.forEach((t) => drawTrack(t));
        needsWaveRedraw.current = false;
      }
      if (needsRulerRedraw.current) {
        const rulerCanvas = document.getElementById("groova-ruler") as HTMLCanvasElement;
        if (rulerCanvas) drawRuler(rulerCanvas);
        needsRulerRedraw.current = false;
      }

      // ⑤ オートスクロール（lerp）
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
  }, [drawTrack, drawRuler]); // tracks等はref経由なので依存不要

  // ── ルーラーpointer drag ──
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
  const handleRulerPointerUp = () => {
    isDraggingPlayhead.current = false;
  };

  // Track clip drag
  const handleTrackPointerDown = (e: React.PointerEvent, trackId: string) => {
    e.stopPropagation();
    isDraggingTrack.current = {
      id: trackId,
      startX: e.clientX,
      origOffset: trackOffsets[trackId] || 0,
    };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const handleTrackPointerMove = (e: React.PointerEvent) => {
    if (!isDraggingTrack.current) return;
    const { id, startX, origOffset } = isDraggingTrack.current;
    const dx = e.clientX - startX;
    setTrackOffsets((prev) => ({ ...prev, [id]: Math.max(0, origOffset + dx / pxPerSecRef.current) }));
  };
  const handleTrackPointerUp = () => { isDraggingTrack.current = null; };

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
    setTrackOffsets((prev) => { const n = { ...prev }; delete n[trackId]; return n; });
    removeTrack(trackId);
  };

  return (
    <div
      style={{ background: "#0a0a0f", borderTop: "1px solid #1a1a24", flex: 1, minHeight: 0, overflow: "hidden", position: "relative" }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
    >
      <AnimatePresence>
        {bpmToast && (
          <BpmToast
            key={`${bpmToast.trackName}-${bpmToast.bpm}`}
            bpm={bpmToast.bpm} trackName={bpmToast.trackName} color={bpmToast.color}
            onDone={() => setBpmToast(null)}
          />
        )}
      </AnimatePresence>

      <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
        {/* 左: ラベル列 */}
        <div style={{
          width: LABEL_WIDTH, flexShrink: 0,
          display: "flex", flexDirection: "column",
          borderRight: "1px solid #1a1a24", background: "#0c0c14", zIndex: 5,
        }}>
          <div style={{
            height: RULER_HEIGHT, flexShrink: 0,
            borderBottom: "1px solid #1a1a24",
            display: "flex", alignItems: "center", paddingLeft: 6,
            background: "#0a0a0f",
          }}>
            <span style={{ fontSize: 9, color: "#333344" }}>TIME</span>
          </div>
          <div style={{ flex: 1, overflowY: "hidden" }}>
            {tracks.map((track) => (
              <TrackLabel
                key={track.id}
                track={track}
                onDelete={() => handleDeleteTrack(track.id)}
                onFileSelect={(file) => loadFile(file, track.id)}
              />
            ))}
            {tracks.length < 6 && (
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
          onScroll={() => {
            if (!isPlayingRef.current) scrollTargetRef.current = null;
          }}
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

            {/* Tracks */}
            {tracks.map((track) => (
              <TrackCanvas
                key={track.id}
                track={track}
                canvasWidth={canvasWidth}
                canvasRefs={canvasRefs}
                onPointerDown={(e) => handleTrackPointerDown(e, track.id)}
                onPointerMove={handleTrackPointerMove}
                onPointerUp={handleTrackPointerUp}
                onDrop={(e) => handleFileDrop(e, track.id)}
                onFileSelect={(file) => loadFile(file, track.id)}
              />
            ))}

            {tracks.length < 6 && (
              <div style={{ height: TRACK_HEIGHT, borderTop: "1px solid #1a1a24", background: "#080810" }} />
            )}

            {/* プレイヘッド — transform で直接移動（Reactレンダリング外） */}
            <div
              ref={playheadLineRef}
              style={{
                position: "absolute", top: 0, left: 0,
                width: 2, height: "100%",
                background: "rgba(255,255,255,0.9)",
                pointerEvents: "none", zIndex: 20,
                willChange: "transform",
              }}
            >
              <div style={{
                position: "absolute", top: RULER_HEIGHT - 8, left: -5,
                width: 12, height: 12, background: "white",
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
function TrackCanvas({ track, canvasWidth, canvasRefs, onPointerDown, onPointerMove, onPointerUp, onDrop, onFileSelect }: {
  track: TrackState;
  canvasWidth: number;
  canvasRefs: React.MutableRefObject<Map<string, HTMLCanvasElement>>;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onFileSelect: (file: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div style={{ height: TRACK_HEIGHT, borderTop: "1px solid #1a1a24", position: "relative" }}>
      <canvas
        ref={(el) => {
          if (el) {
            const isNew = !canvasRefs.current.get(track.id);
            canvasRefs.current.set(track.id, el);
            if (isNew) { el.width = canvasWidth; el.height = TRACK_HEIGHT; }
          }
        }}
        style={{
          width: "100%", height: "100%", display: "block",
          touchAction: track.audioBuffer ? "none" : "pan-x",
          cursor: track.audioBuffer ? "grab" : "default",
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
