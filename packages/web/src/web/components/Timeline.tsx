import { useRef, useEffect, useCallback, useState } from "react";
import { motion } from "framer-motion";
import { useGROOVA, TrackState } from "../lib/store";
import { analyzeBPM, decodeAudioFile, extractWaveform } from "../lib/bpmAnalyzer";
import { audioEngine } from "../lib/audioEngine";

const TRACK_HEIGHT = 52;
const RULER_HEIGHT = 28;
const LABEL_WIDTH = 52;
const PIXELS_PER_SEC_BASE = 80;

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
  } = useGROOVA();

  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const animRef = useRef<number>();
  const isDraggingPlayhead = useRef(false);
  const isDraggingTrack = useRef<{ id: string; startX: number; origOffset: number } | null>(null);
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);

  // Each track has an offset (seconds) for horizontal positioning
  const [trackOffsets, setTrackOffsets] = useState<Record<string, number>>({});
  const pxPerSec = PIXELS_PER_SEC_BASE * zoomLevel;

  // Max duration across all tracks (for canvas width)
  const maxDuration = Math.max(
    30,
    ...tracks.map((t) => {
      const dur = t.audioBuffer?.duration || 0;
      const off = trackOffsets[t.id] || 0;
      return off + dur;
    })
  );
  const totalWidth = Math.max(maxDuration * pxPerSec + LABEL_WIDTH + 200, 800);

  // Draw all track waveforms
  const drawTrack = useCallback(
    (track: TrackState) => {
      const canvas = canvasRefs.current.get(track.id);
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      // background
      ctx.fillStyle = "#0d0d14";
      ctx.fillRect(0, 0, W, H);

      const offset = trackOffsets[track.id] || 0;
      const waveform = track.waveformData;
      const duration = track.audioBuffer?.duration || 0;

      if (waveform && duration > 0) {
        const clipX = offset * pxPerSec;
        const clipW = duration * pxPerSec;

        // Clip background
        ctx.fillStyle = track.color + "18";
        ctx.beginPath();
        ctx.roundRect(clipX, 2, clipW, H - 4, 4);
        ctx.fill();

        // Border
        ctx.strokeStyle = track.color + "66";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(clipX, 2, clipW, H - 4, 4);
        ctx.stroke();

        // Waveform bars
        const barCount = Math.floor(clipW);
        const samplesPerBar = waveform.length / barCount;
        for (let i = 0; i < barCount; i++) {
          const sampleIdx = Math.floor(i * samplesPerBar);
          const amp = waveform[Math.min(sampleIdx, waveform.length - 1)];
          const barH = amp * (H - 8) * 0.85;
          const x = clipX + i;
          ctx.fillStyle = track.color + "cc";
          ctx.fillRect(x, (H - barH) / 2, 1, barH);
        }

        // Track name label inside clip
        ctx.fillStyle = track.color + "99";
        ctx.font = "bold 9px Space Grotesk, sans-serif";
        ctx.fillText(track.name, clipX + 6, H - 6);

        // BPM label
        if (track.bpm) {
          ctx.fillStyle = track.color;
          ctx.font = "bold 9px JetBrains Mono, monospace";
          ctx.fillText(`${track.bpm}`, clipX + 6, 14);
        }

        // Trim handles
        const trimStartX = clipX + (track.trimStart / duration) * clipW;
        const trimEndX = clipX + ((track.trimEnd || duration) / duration) * clipW;

        // Start handle
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(trimStartX - 1, 0, 2, H);
        ctx.beginPath();
        ctx.moveTo(trimStartX, 2);
        ctx.lineTo(trimStartX + 10, 2);
        ctx.lineTo(trimStartX, 14);
        ctx.fill();

        // End handle
        ctx.fillRect(trimEndX - 1, 0, 2, H);
        ctx.beginPath();
        ctx.moveTo(trimEndX, 2);
        ctx.lineTo(trimEndX - 10, 2);
        ctx.lineTo(trimEndX, 14);
        ctx.fill();
      } else {
        // Empty track — drop hint
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

      // Scan animation during analysis
      if (track.isAnalyzing) {
        const scanX = ((Date.now() % 2000) / 2000) * W;
        const grad = ctx.createLinearGradient(scanX - 40, 0, scanX + 40, 0);
        grad.addColorStop(0, "rgba(0,245,255,0)");
        grad.addColorStop(0.5, "rgba(0,245,255,0.7)");
        grad.addColorStop(1, "rgba(0,245,255,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(scanX - 40, 0, 80, H);
      }

      // Playhead line (always drawn on top)
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

  // Draw ruler
  const drawRuler = useCallback(
    (canvas: HTMLCanvasElement) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const W = canvas.width;
      const H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      ctx.fillStyle = "#0a0a0f";
      ctx.fillRect(0, 0, W, H);

      // Time ticks
      const stepSec = pxPerSec > 120 ? 1 : pxPerSec > 60 ? 2 : pxPerSec > 30 ? 4 : 8;
      const beatSec = 60 / masterBpm;

      // Grid lines (8-count)
      if (showGrid) {
        let t = 0;
        let beatIdx = 0;
        while (t <= maxDuration) {
          const x = LABEL_WIDTH + t * pxPerSec;
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

      // Time labels
      ctx.fillStyle = "#555566";
      ctx.font = "9px JetBrains Mono, monospace";
      let t = 0;
      while (t <= maxDuration + stepSec) {
        const x = LABEL_WIDTH + t * pxPerSec;
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

  // Resize canvases (サイズ変更はrAFと分離して先にやる)
  useEffect(() => {
    tracks.forEach((t) => {
      const canvas = canvasRefs.current.get(t.id);
      if (canvas) {
        if (canvas.width !== totalWidth - LABEL_WIDTH) canvas.width = totalWidth - LABEL_WIDTH;
        if (canvas.height !== TRACK_HEIGHT) canvas.height = TRACK_HEIGHT;
      }
    });
    const ruler = document.getElementById("groova-ruler") as HTMLCanvasElement;
    if (ruler) {
      if (ruler.width !== totalWidth - LABEL_WIDTH) ruler.width = totalWidth - LABEL_WIDTH;
      if (ruler.height !== RULER_HEIGHT) ruler.height = RULER_HEIGHT;
    }
  }, [tracks.length, totalWidth, zoomLevel]);

  // Animation loop — 常時rAFで再描画
  useEffect(() => {
    const loop = () => {
      const rulerCanvas = document.getElementById("groova-ruler") as HTMLCanvasElement;
      tracks.forEach((t) => drawTrack(t));
      if (rulerCanvas) drawRuler(rulerCanvas);
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [tracks, drawTrack, drawRuler]);

  // Playhead position
  const playheadX = LABEL_WIDTH + playheadTime * pxPerSec;

  // Pointer: playhead drag
  const handleScrollPointerDown = (e: React.PointerEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left - LABEL_WIDTH + (scrollRef.current?.scrollLeft || 0);
    if (x < 0) return;
    isDraggingPlayhead.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setPlayheadTime(Math.max(0, x / pxPerSec));
  };
  const handleScrollPointerMove = (e: React.PointerEvent) => {
    if (!isDraggingPlayhead.current) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left - LABEL_WIDTH + (scrollRef.current?.scrollLeft || 0);
    setPlayheadTime(Math.max(0, x / pxPerSec));
  };
  const handleScrollPointerUp = () => {
    isDraggingPlayhead.current = false;
  };

  // Track clip drag
  const handleTrackPointerDown = (e: React.PointerEvent, trackId: string) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft || 0);
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
      const newZoom = Math.max(0.5, Math.min(8, pinchRef.current.zoom * ratio));
      useGROOVA.getState().setZoom(newZoom);
    }
  };

  // File drop on track
  const handleFileDrop = async (e: React.DragEvent, trackId: string) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    loadFile(file, trackId);
  };

  const loadFile = async (file: File, trackId: string) => {
    updateTrack(trackId, { file, isAnalyzing: true, bpm: null, waveformData: null });
    try {
      const ctx = audioEngine.getContext();
      const audioBuffer = await decodeAudioFile(file, ctx);
      // duration × 80px/sec × zoomLevel ≒ 実際のcanvasピクセル幅、余裕を持って8000サンプル
      const waveformData = extractWaveform(audioBuffer, 8000);
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
      {/* Scrollable area */}
      <div
        ref={scrollRef}
        className="overflow-x-auto overflow-y-hidden flex-1"
        style={{ scrollbarHeight: "thin", scrollbarColor: "#252535 #0a0a0f" }}
        onPointerDown={handleScrollPointerDown}
        onPointerMove={handleScrollPointerMove}
        onPointerUp={handleScrollPointerUp}
      >
        <div style={{ width: totalWidth, position: "relative" }}>
          {/* Ruler */}
          <div style={{ display: "flex", height: RULER_HEIGHT }}>
            {/* Label spacer */}
            <div
              style={{
                width: LABEL_WIDTH,
                flexShrink: 0,
                background: "#0a0a0f",
                borderRight: "1px solid #1a1a24",
                display: "flex",
                alignItems: "center",
                paddingLeft: 6,
              }}
            >
              <span style={{ fontSize: 9, color: "#333344" }}>TIME</span>
            </div>
            <canvas
              id="groova-ruler"
              width={totalWidth - LABEL_WIDTH}
              height={RULER_HEIGHT}
              style={{ display: "block" }}
            />
          </div>

          {/* Tracks */}
          {tracks.map((track, idx) => (
            <TrackRow
              key={track.id}
              track={track}
              idx={idx}
              totalWidth={totalWidth}
              canvasRefs={canvasRefs}
              onPointerDown={(e) => handleTrackPointerDown(e, track.id)}
              onPointerMove={handleTrackPointerMove}
              onPointerUp={handleTrackPointerUp}
              onDrop={(e) => handleFileDrop(e, track.id)}
              onFileSelect={(file) => loadFile(file, track.id)}
            />
          ))}

          {/* Add track row */}
          {tracks.length < 6 && (
            <div
              style={{
                display: "flex",
                height: TRACK_HEIGHT,
                borderTop: "1px solid #1a1a24",
              }}
            >
              <div
                style={{
                  width: LABEL_WIDTH,
                  flexShrink: 0,
                  background: "#0a0a0f",
                  borderRight: "1px solid #1a1a24",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <button
                  onClick={addTrack}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 999,
                    background: "#1a1a24",
                    border: "1px solid #2a2a3a",
                    color: "#a8ff3e",
                    fontSize: 16,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                  }}
                >
                  +
                </button>
              </div>
              <div
                style={{
                  flex: 1,
                  background: "#080810",
                  borderTop: "1px dashed #1a1a24",
                }}
              />
            </div>
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
            {/* Diamond */}
            <div
              style={{
                position: "absolute",
                top: -1,
                left: -6,
                width: 14,
                height: 14,
                background: "white",
                clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// Individual track row
function TrackRow({
  track, idx, totalWidth, canvasRefs,
  onPointerDown, onPointerMove, onPointerUp, onDrop, onFileSelect,
}: {
  track: TrackState;
  idx: number;
  totalWidth: number;
  canvasRefs: React.MutableRefObject<Map<string, HTMLCanvasElement>>;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onFileSelect: (file: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const { updateTrack } = useGROOVA();

  return (
    <div
      style={{
        display: "flex",
        height: TRACK_HEIGHT,
        borderTop: "1px solid #1a1a24",
        position: "relative",
      }}
    >
      {/* Label */}
      <div
        style={{
          width: LABEL_WIDTH,
          flexShrink: 0,
          background: "#0c0c14",
          borderRight: "1px solid #1a1a24",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 2,
          padding: "0 4px",
        }}
      >
        {/* Color dot */}
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: track.color,
            boxShadow: `0 0 6px ${track.color}`,
            flexShrink: 0,
          }}
        />
        {/* Mute button */}
        <button
          onClick={() => updateTrack(track.id, { muted: !track.muted })}
          style={{
            fontSize: 8,
            padding: "1px 3px",
            borderRadius: 3,
            background: track.muted ? "#ff6b2b22" : "#1a1a24",
            border: `1px solid ${track.muted ? "#ff6b2b44" : "#2a2a3a"}`,
            color: track.muted ? "#ff6b2b" : "#4a4a5a",
            cursor: "pointer",
            lineHeight: 1.4,
          }}
        >
          {track.muted ? "M" : "M"}
        </button>
        {/* File picker */}
        <button
          onClick={() => fileRef.current?.click()}
          style={{
            fontSize: 14,
            background: "none",
            border: "none",
            color: track.audioBuffer ? track.color : "#2a2a3a",
            cursor: "pointer",
            padding: 0,
            lineHeight: 1,
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
      </div>

      {/* Canvas area */}
      <div style={{ flex: 1, position: "relative" }}>
        <canvas
          ref={(el) => {
            if (el) {
              canvasRefs.current.set(track.id, el);
              el.width = totalWidth - LABEL_WIDTH;
              el.height = TRACK_HEIGHT;
            }
          }}
          style={{
            width: "100%",
            height: "100%",
            display: "block",
            touchAction: "none",
            cursor: track.audioBuffer ? "grab" : "default",
            // 空トラック時はcanvasをクリックイベントの対象外にする
            pointerEvents: track.audioBuffer ? "auto" : "none",
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
        />
        {/* 音源未読み込み時のオーバーレイボタン */}
        {!track.audioBuffer && !track.isAnalyzing && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              // iOS: タップの同期コンテキストでAudioContextをアンロック
              audioEngine.unlockContext();
              fileRef.current?.click();
            }}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-start",
              paddingLeft: 16,
              gap: 8,
              color: "#4a4a6a",
              zIndex: 2,
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
        {/* 解析中表示 */}
        {track.isAnalyzing && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              paddingLeft: 16,
              gap: 8,
              color: track.color,
              fontSize: 12,
            }}
          >
            <span style={{ animation: "spin 1s linear infinite", display: "inline-block" }}>⟳</span>
            解析中…
          </div>
        )}
      </div>
    </div>
  );
}
