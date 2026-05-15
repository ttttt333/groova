import { useRef, useEffect, useCallback, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useGROOVA, TrackState } from "../lib/store";
import { analyzeBPM, decodeAudioFile, extractWaveform } from "../lib/bpmAnalyzer";
import { audioEngine } from "../lib/audioEngine";

const TRACK_HEIGHT = 76;
const RULER_HEIGHT = 32;
const LABEL_WIDTH = 52;
const PIXELS_PER_SEC_BASE = 80;

/** BPM検出完了トースト */
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
        position: "absolute",
        top: 8,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 100,
        background: "#111118ee",
        border: `1.5px solid ${color}66`,
        borderRadius: 12,
        padding: "8px 16px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        backdropFilter: "blur(8px)",
        boxShadow: `0 4px 20px ${color}22`,
      }}
    >
      <span style={{
        fontFamily: "JetBrains Mono, monospace",
        fontWeight: 800,
        fontSize: 28,
        color,
        textShadow: `0 0 20px ${color}88`,
        lineHeight: 1,
      }}>
        {bpm}
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <span style={{
          fontSize: 10, color: "#888899",
          fontFamily: "Space Grotesk, sans-serif", fontWeight: 600,
        }}>
          BPM 検出
        </span>
        <span style={{
          fontSize: 11, color: "#ccccdd",
          fontFamily: "Space Grotesk, sans-serif", fontWeight: 500,
        }}>
          {trackName}
        </span>
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
    tracks, updateTrack, masterBpm, showGrid, playheadTime,
    setPlayheadTime, isPlaying, zoomLevel, addTrack, setMasterBpm,
    scrollResetCounter, removeTrack,
  } = useGROOVA();

  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const animRef = useRef<number>();
  const isDraggingPlayhead = useRef(false);
  const isDraggingTrack = useRef<{ id: string; startX: number; origOffset: number } | null>(null);
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);

  const [trackOffsets, setTrackOffsets] = useState<Record<string, number>>({});
  const [bpmToast, setBpmToast] = useState<{ bpm: number; trackName: string; color: string } | null>(null);
  const prevBpmRef = useRef<Record<string, number | null>>({});
  const pxPerSec = PIXELS_PER_SEC_BASE * zoomLevel;

  const maxDuration = Math.max(
    30,
    ...tracks.map((t) => {
      const dur = t.audioBuffer?.duration || 0;
      const off = trackOffsets[t.id] || 0;
      return off + dur;
    })
  );
  // canvasの幅 = ラベル幅を除いたタイムライン部分
  const canvasWidth = Math.max(maxDuration * pxPerSec + 200, 600);

  // スクロールリセット（⏮ボタン）
  useEffect(() => {
    if (scrollResetCounter > 0 && scrollRef.current) {
      scrollRef.current.scrollLeft = 0;
    }
  }, [scrollResetCounter]);

  // BPM検出時にトーストを表示
  useEffect(() => {
    tracks.forEach((t) => {
      const prev = prevBpmRef.current[t.id];
      if (prev === undefined || prev === null) {
        if (t.bpm && t.bpm > 0) {
          setBpmToast({ bpm: t.bpm, trackName: t.name, color: t.color });
        }
      }
      prevBpmRef.current[t.id] = t.bpm;
    });
  }, [tracks]);

  // Draw a single track waveform onto its canvas
  const drawTrack = useCallback(
    (track: TrackState) => {
      const canvas = canvasRefs.current.get(track.id);
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      ctx.fillStyle = "#0d0d14";
      ctx.fillRect(0, 0, W, H);

      const offset = trackOffsets[track.id] || 0;
      const waveform = track.waveformData;
      const duration = track.audioBuffer?.duration || 0;

      if (waveform && duration > 0) {
        // clipX はラベルなしのcanvas座標
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
            for (let s = sStart; s < sEnd; s++) {
              if (waveform[s] > max) max = waveform[s];
            }
            const y = midY - max * ampScale;
            if (px === 0) ctx.moveTo(clipX + px, y);
            else ctx.lineTo(clipX + px, y);
          }
          for (let px = Math.floor(clipW) - 1; px >= 0; px--) {
            const sStart = Math.floor(px * samplesPerPx);
            const sEnd = Math.min(Math.ceil((px + 1) * samplesPerPx), waveform.length);
            let max = 0;
            for (let s = sStart; s < sEnd; s++) {
              if (waveform[s] > max) max = waveform[s];
            }
            const y = midY + max * ampScale;
            ctx.lineTo(clipX + px, y);
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
          // scrollLeft はラベルなしcanvas内の座標と一致
          const visStart = Math.max(0, Math.floor(((scrollLeft - clipX) / clipW) * waveform.length) - 2);
          const visEnd = Math.min(waveform.length, Math.ceil(((scrollLeft + viewWidth - clipX) / clipW) * waveform.length) + 2);

          ctx.fillStyle = track.color + "dd";
          const midY = H / 2;
          const ampScale = (H - 8) * 0.42;
          for (let i = visStart; i < visEnd; i++) {
            const amp = waveform[i];
            const barH = amp * ampScale * 2;
            const x = clipX + i * pxPerSample;
            ctx.fillRect(x, midY - barH / 2, barW, barH);
          }
          ctx.strokeStyle = track.color + "44";
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(clipX, midY);
          ctx.lineTo(clipX + clipW, midY);
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
        ctx.beginPath();
        ctx.moveTo(trimStartX, 2);
        ctx.lineTo(trimStartX + 10, 2);
        ctx.lineTo(trimStartX, 14);
        ctx.fill();

        ctx.fillRect(trimEndX - 1, 0, 2, H);
        ctx.beginPath();
        ctx.moveTo(trimEndX, 2);
        ctx.lineTo(trimEndX - 10, 2);
        ctx.lineTo(trimEndX, 14);
        ctx.fill();
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
      }

      // Playhead（canvas座標 = ラベルなし）
      const phX = playheadTime * pxPerSec;
      if (phX >= 0 && phX <= W) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.moveTo(phX, 0);
        ctx.lineTo(phX, H);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    },
    [trackOffsets, pxPerSec, playheadTime]
  );

  // Draw ruler canvas
  const drawRuler = useCallback(
    (canvas: HTMLCanvasElement) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      ctx.fillStyle = "#0a0a0f";
      ctx.fillRect(0, 0, W, H);

      const stepSec = pxPerSec > 120 ? 1 : pxPerSec > 60 ? 2 : pxPerSec > 30 ? 4 : 8;
      const beatSec = 60 / masterBpm;

      if (showGrid) {
        let t = 0;
        let beatIdx = 0;
        while (t <= maxDuration) {
          const x = t * pxPerSec; // ruler canvas はラベル幅なし
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

      ctx.fillStyle = "#555566";
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
    },
    [pxPerSec, maxDuration, showGrid, masterBpm]
  );

  // Canvas resize
  useEffect(() => {
    tracks.forEach((t) => {
      const canvas = canvasRefs.current.get(t.id);
      if (canvas) {
        if (canvas.width !== canvasWidth) canvas.width = canvasWidth;
        if (canvas.height !== TRACK_HEIGHT) canvas.height = TRACK_HEIGHT;
      }
    });
    const ruler = document.getElementById("groova-ruler") as HTMLCanvasElement;
    if (ruler) {
      if (ruler.width !== canvasWidth) ruler.width = canvasWidth;
      if (ruler.height !== RULER_HEIGHT) ruler.height = RULER_HEIGHT;
    }
  }, [tracks.length, canvasWidth, zoomLevel]);

  // Animation loop + autoscroll
  useEffect(() => {
    const loop = () => {
      const rulerCanvas = document.getElementById("groova-ruler") as HTMLCanvasElement;
      tracks.forEach((t) => drawTrack(t));
      if (rulerCanvas) drawRuler(rulerCanvas);

      if (isPlaying && scrollRef.current && !isDraggingPlayhead.current) {
        const container = scrollRef.current;
        // phX はスクロールコンテンツ内座標（ラベル幅なし）
        const phX = playheadTime * pxPerSec;
        const viewLeft = container.scrollLeft;
        const viewW = container.clientWidth;
        const threshold = viewLeft + viewW * 0.75;
        if (phX > threshold) {
          container.scrollLeft = phX - viewW * 0.25;
        }
        if (phX < viewLeft) {
          container.scrollLeft = Math.max(0, phX - 20);
        }
      }

      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [tracks, drawTrack, drawRuler, isPlaying, playheadTime, pxPerSec]);

  // Playhead DOM position（スクロールコンテンツ内、ラベルなし）
  const playheadX = playheadTime * pxPerSec;

  // Pointer: playhead drag on ruler/canvas scroll area
  const handleScrollPointerDown = (e: React.PointerEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft || 0);
    if (x < 0) return;
    isDraggingPlayhead.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setPlayheadTime(Math.max(0, x / pxPerSec));
  };
  const handleScrollPointerMove = (e: React.PointerEvent) => {
    if (!isDraggingPlayhead.current) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft || 0);
    setPlayheadTime(Math.max(0, x / pxPerSec));
  };
  const handleScrollPointerUp = () => {
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
    const newOffset = Math.max(0, origOffset + dx / pxPerSec);
    setTrackOffsets((prev) => ({ ...prev, [id]: newOffset }));
  };
  const handleTrackPointerUp = () => {
    isDraggingTrack.current = null;
  };

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
      const dist = Math.hypot(dx, dy);
      const ratio = dist / pinchRef.current.dist;
      const newZoom = Math.max(0.25, Math.min(64, pinchRef.current.zoom * ratio));
      useGROOVA.getState().setZoom(newZoom);
    }
  };

  const handleFileDrop = async (e: React.DragEvent, trackId: string) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    loadFile(file, trackId);
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
      const { tracks: currentTracks } = useGROOVA.getState();
      const hasNoMaster = !currentTracks.find((t) => t.id !== trackId && t.bpm);
      if (hasNoMaster) setMasterBpm(result.bpm);
    } catch (err) {
      console.error(err);
      updateTrack(trackId, { isAnalyzing: false });
    }
  };

  const handleDeleteTrack = (trackId: string) => {
    // トラックのcanvasを削除
    canvasRefs.current.delete(trackId);
    // trackOffsetsからも削除
    setTrackOffsets((prev) => {
      const next = { ...prev };
      delete next[trackId];
      return next;
    });
    removeTrack(trackId);
  };

  return (
    <div
      className="relative flex flex-col"
      style={{
        background: "#0a0a0f",
        borderTop: "1px solid #1a1a24",
        flex: 1,
        minHeight: 0,
        overflow: "hidden",
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
    >
      {/* BPM検出トースト */}
      <AnimatePresence>
        {bpmToast && (
          <BpmToast
            key={`${bpmToast.trackName}-${bpmToast.bpm}`}
            bpm={bpmToast.bpm}
            trackName={bpmToast.trackName}
            color={bpmToast.color}
            onDone={() => setBpmToast(null)}
          />
        )}
      </AnimatePresence>

      {/* ── レイアウト: ラベル列（固定） + スクロール列 ── */}
      <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>

        {/* 左: ラベル列（スクロールしない） */}
        <div
          style={{
            width: LABEL_WIDTH,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            borderRight: "1px solid #1a1a24",
            background: "#0c0c14",
            zIndex: 5,
          }}
        >
          {/* Ruler label */}
          <div style={{
            height: RULER_HEIGHT,
            borderBottom: "1px solid #1a1a24",
            display: "flex", alignItems: "center", paddingLeft: 6,
            background: "#0a0a0f",
          }}>
            <span style={{ fontSize: 9, color: "#333344" }}>TIME</span>
          </div>

          {/* Track labels */}
          {tracks.map((track) => (
            <TrackLabel
              key={track.id}
              track={track}
              onDelete={() => handleDeleteTrack(track.id)}
              onFileSelect={(file) => loadFile(file, track.id)}
            />
          ))}

          {/* Add track */}
          {tracks.length < 6 && (
            <div style={{
              height: TRACK_HEIGHT,
              borderTop: "1px solid #1a1a24",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <button
                onClick={addTrack}
                style={{
                  width: 24, height: 24, borderRadius: 999,
                  background: "#1a1a24", border: "1px solid #2a2a3a",
                  color: "#a8ff3e", fontSize: 16,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer",
                }}
              >+</button>
            </div>
          )}
        </div>

        {/* 右: スクロール領域（ruler + tracks + playhead） */}
        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflowX: "auto",
            overflowY: "hidden",
            scrollbarWidth: "thin",
            scrollbarColor: "#252535 #0a0a0f",
            position: "relative",
          }}
          onPointerDown={handleScrollPointerDown}
          onPointerMove={handleScrollPointerMove}
          onPointerUp={handleScrollPointerUp}
        >
          {/* コンテンツ幅を確保する wrapper */}
          <div style={{ width: canvasWidth, position: "relative" }}>
            {/* Ruler canvas */}
            <div style={{ height: RULER_HEIGHT }}>
              <canvas
                id="groova-ruler"
                width={canvasWidth}
                height={RULER_HEIGHT}
                style={{ display: "block" }}
              />
            </div>

            {/* Track canvases */}
            {tracks.map((track, idx) => (
              <TrackCanvas
                key={track.id}
                track={track}
                idx={idx}
                canvasWidth={canvasWidth}
                canvasRefs={canvasRefs}
                onPointerDown={(e) => handleTrackPointerDown(e, track.id)}
                onPointerMove={handleTrackPointerMove}
                onPointerUp={handleTrackPointerUp}
                onDrop={(e) => handleFileDrop(e, track.id)}
                onFileSelect={(file) => loadFile(file, track.id)}
              />
            ))}

            {/* Add track empty area */}
            {tracks.length < 6 && (
              <div style={{
                height: TRACK_HEIGHT,
                borderTop: "1px solid #1a1a24",
                background: "#080810",
              }} />
            )}

            {/* Playhead */}
            <div
              style={{
                position: "absolute",
                top: 0,
                left: playheadX,
                width: 2,
                height: "100%",
                background: "white",
                pointerEvents: "none",
                zIndex: 20,
              }}
            >
              <div style={{
                position: "absolute",
                top: -1, left: -6,
                width: 14, height: 14,
                background: "white",
                clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
              }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── ラベル列の各行 ──
function TrackLabel({
  track, onDelete, onFileSelect,
}: {
  track: TrackState;
  onDelete: () => void;
  onFileSelect: (file: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { updateTrack } = useGROOVA();
  const [confirmDelete, setConfirmDelete] = useState(false);

  // 削除確認: 1回目タップで赤に、2回目タップで実行、2秒後にリセット
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
      height: TRACK_HEIGHT,
      borderTop: "1px solid #1a1a24",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 3,
      padding: "4px 2px",
      position: "relative",
    }}>
      {/* カラードット */}
      <div style={{
        width: 7, height: 7, borderRadius: "50%",
        background: track.color,
        boxShadow: `0 0 6px ${track.color}`,
        flexShrink: 0,
      }} />

      {/* ミュートボタン */}
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

      {/* ファイル選択 / 音源あり時は♪ */}
      <button
        onClick={() => {
          audioEngine.unlockContext();
          fileRef.current?.click();
        }}
        style={{
          fontSize: 13, background: "none", border: "none",
          color: track.audioBuffer ? track.color : "#2a2a3a",
          cursor: "pointer", padding: 0, lineHeight: 1,
        }}
        title="曲を追加"
      >
        {track.audioBuffer ? "♪" : "+"}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="audio/*,.mp3,.m4a,.wav,.flac,.ogg,.aac"
        style={{ display: "none" }}
        onChange={(e) => e.target.files?.[0] && onFileSelect(e.target.files[0])}
      />

      {/* 削除ボタン（音源読み込み済み時のみ表示） */}
      {track.audioBuffer && (
        <button
          onClick={handleDeleteTap}
          title={confirmDelete ? "もう一度タップで削除" : "音源を削除"}
          style={{
            fontSize: 9, padding: "1px 3px", borderRadius: 3,
            background: confirmDelete ? "#ff000033" : "#1a1a24",
            border: `1px solid ${confirmDelete ? "#ff0000aa" : "#2a2a3a"}`,
            color: confirmDelete ? "#ff4444" : "#4a4a5a",
            cursor: "pointer", lineHeight: 1.4,
            transition: "all 0.15s",
          }}
        >
          {confirmDelete ? "確認" : "削除"}
        </button>
      )}
    </div>
  );
}

// ── Canvas列の各行 ──
function TrackCanvas({
  track, idx, canvasWidth, canvasRefs,
  onPointerDown, onPointerMove, onPointerUp, onDrop, onFileSelect,
}: {
  track: TrackState;
  idx: number;
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
    <div style={{
      height: TRACK_HEIGHT,
      borderTop: "1px solid #1a1a24",
      position: "relative",
    }}>
      <canvas
        ref={(el) => {
          if (el) {
            canvasRefs.current.set(track.id, el);
            if (el.width !== canvasWidth) el.width = canvasWidth;
            if (el.height !== TRACK_HEIGHT) el.height = TRACK_HEIGHT;
          }
        }}
        style={{
          width: "100%", height: "100%",
          display: "block", touchAction: "none",
          cursor: track.audioBuffer ? "grab" : "default",
          pointerEvents: track.audioBuffer ? "auto" : "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      />

      {/* 音源未読み込み時のオーバーレイ */}
      {!track.audioBuffer && !track.isAnalyzing && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            audioEngine.unlockContext();
            fileRef.current?.click();
          }}
          style={{
            position: "absolute", inset: 0,
            width: "100%", height: "100%",
            background: "transparent", border: "none",
            cursor: "pointer",
            display: "flex", alignItems: "center",
            justifyContent: "flex-start",
            paddingLeft: 16, gap: 8,
            color: "#4a4a6a", zIndex: 2,
          }}
        >
          <span style={{
            width: 28, height: 28, borderRadius: "50%",
            border: "1.5px dashed #3a3a5a",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 18, lineHeight: 1, color: "#5a5a7a", flexShrink: 0,
          }}>+</span>
          <span style={{ fontSize: 12, letterSpacing: "0.02em" }}>音源を読み込む</span>
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="audio/*,.mp3,.m4a,.wav,.flac,.ogg,.aac"
        style={{ display: "none" }}
        onChange={(e) => e.target.files?.[0] && onFileSelect(e.target.files[0])}
      />

      {/* 解析中 */}
      {track.isAnalyzing && (
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", alignItems: "center",
          paddingLeft: 16, gap: 8,
          color: track.color, fontSize: 12,
        }}>
          <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span>
          解析中…
        </div>
      )}
    </div>
  );
}
