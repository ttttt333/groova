import { useRef, useEffect, useCallback } from "react";
import { useGROOVA, TrackState } from "../lib/store";
import { motion } from "framer-motion";

type Props = {
  track: TrackState;
  height?: number;
  onTrimChange?: (start: number, end: number | null) => void;
};

export default function WaveformCanvas({ track, height = 80, onTrimChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { showGrid, masterBpm, playheadTime, isPlaying } = useGROOVA();
  const dragRef = useRef<{ type: "start" | "end" | "playhead" | null; startX: number; startVal: number }>({ type: null, startX: 0, startVal: 0 });
  const scanRef = useRef(0);
  const animRef = useRef<number>();

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = "#111118";
    ctx.fillRect(0, 0, W, H);

    const waveform = track.waveformData;
    const duration = track.audioBuffer?.duration || 0;

    // Draw waveform
    if (waveform && waveform.length > 0) {
      const barWidth = W / waveform.length;

      // Trim region highlight
      const trimStartX = duration > 0 ? (track.trimStart / duration) * W : 0;
      const trimEndX = duration > 0 && track.trimEnd ? (track.trimEnd / duration) * W : W;

      // Dimmed outside trim
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(0, 0, trimStartX, H);
      ctx.fillRect(trimEndX, 0, W - trimEndX, H);

      for (let i = 0; i < waveform.length; i++) {
        const x = i * barWidth;
        const amp = waveform[i];
        const barH = amp * H * 0.9;
        const inTrim = x >= trimStartX && x <= trimEndX;

        // Color by track
        ctx.fillStyle = inTrim ? track.color + "cc" : "#2a2a3a";
        ctx.fillRect(x, (H - barH) / 2, Math.max(1, barWidth - 0.5), barH);
      }

      // Trim handles
      // Start handle
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(trimStartX, 0);
      ctx.lineTo(trimStartX, H);
      ctx.stroke();
      // Triangle handle
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(trimStartX, 0);
      ctx.lineTo(trimStartX + 12, 0);
      ctx.lineTo(trimStartX, 14);
      ctx.fill();

      // End handle
      ctx.beginPath();
      ctx.moveTo(trimEndX, 0);
      ctx.lineTo(trimEndX, H);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(trimEndX, 0);
      ctx.lineTo(trimEndX - 12, 0);
      ctx.lineTo(trimEndX, 14);
      ctx.fill();
    }

    // 8-Count Grid — beatPositions 基準（解析済みなら）、なければ BPM 固定
    if (showGrid && duration > 0) {
      const beats = track.beatPositions;
      const hasBeatPositions = beats && beats.length > 0;

      if (hasBeatPositions) {
        // 解析済みのビート位置を使う（正確）
        beats.forEach((beatTime, i) => {
          if (beatTime < 0 || beatTime > duration) return;
          const x = (beatTime / duration) * W;
          const beat = i % 8;

          if (beat === 0) {
            ctx.strokeStyle = "rgba(168, 255, 62, 0.9)";
            ctx.lineWidth = 2;
          } else if (beat === 4) {
            ctx.strokeStyle = "rgba(168, 255, 62, 0.5)";
            ctx.lineWidth = 1.5;
          } else {
            ctx.strokeStyle = "rgba(168, 255, 62, 0.2)";
            ctx.lineWidth = 0.5;
          }

          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, H);
          ctx.stroke();

          if (beat === 0) {
            const countNum = Math.floor(i / 8) + 1;
            ctx.fillStyle = "rgba(168, 255, 62, 0.7)";
            ctx.font = "9px JetBrains Mono, monospace";
            ctx.fillText(`[${countNum}]`, x + 2, 10);
          }
        });
      } else if (masterBpm > 0) {
        // 解析前フォールバック：BPM固定グリッド
        const secPerBeat = 60 / masterBpm;
        let t = 0;
        let beatIdx = 0;
        while (t <= duration) {
          const x = (t / duration) * W;
          const beat = beatIdx % 8;
          ctx.strokeStyle = beat === 0
            ? "rgba(168, 255, 62, 0.9)"
            : beat === 4
              ? "rgba(168, 255, 62, 0.5)"
              : "rgba(168, 255, 62, 0.2)";
          ctx.lineWidth = beat === 0 ? 2 : beat === 4 ? 1.5 : 0.5;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, H);
          ctx.stroke();
          if (beat === 0) {
            ctx.fillStyle = "rgba(168, 255, 62, 0.7)";
            ctx.font = "9px JetBrains Mono, monospace";
            ctx.fillText(`[${Math.floor(beatIdx / 8) + 1}]`, x + 2, 10);
          }
          t += secPerBeat;
          beatIdx++;
        }
      }
    }

    // Playhead
    if (duration > 0) {
      const px = (playheadTime / duration) * W;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, H);
      ctx.stroke();

      // Playhead diamond
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px + 6, 8);
      ctx.lineTo(px, 16);
      ctx.lineTo(px - 6, 8);
      ctx.closePath();
      ctx.fill();
    }

    // Scan animation during analysis
    if (track.isAnalyzing) {
      scanRef.current = (scanRef.current + 3) % W;
      const grad = ctx.createLinearGradient(scanRef.current - 30, 0, scanRef.current + 30, 0);
      grad.addColorStop(0, "rgba(0, 245, 255, 0)");
      grad.addColorStop(0.5, "rgba(0, 245, 255, 0.8)");
      grad.addColorStop(1, "rgba(0, 245, 255, 0)");
      ctx.fillStyle = grad;
      ctx.fillRect(scanRef.current - 30, 0, 60, H);
    }
  }, [track, showGrid, masterBpm, playheadTime]);

  useEffect(() => {
    const loop = () => {
      draw();
      animRef.current = requestAnimationFrame(loop);
    };
    animRef.current = requestAnimationFrame(loop);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [draw]);

  // Handle resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const canvas = canvasRef.current;
      if (canvas && el) {
        canvas.width = el.clientWidth * window.devicePixelRatio;
        canvas.height = height * window.devicePixelRatio;
        canvas.style.width = "100%";
        canvas.style.height = `${height}px`;
        const ctx2 = canvas.getContext("2d");
        if (ctx2) ctx2.scale(window.devicePixelRatio, window.devicePixelRatio);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [height]);

  // Touch/mouse drag for trim handles
  const getXFromEvent = (e: React.TouchEvent | React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
    return (clientX - rect.left) / rect.width;
  };

  const handlePointerDown = (e: React.TouchEvent | React.MouseEvent) => {
    const xRatio = getXFromEvent(e);
    const duration = track.audioBuffer?.duration || 0;
    if (!duration) return;

    const trimStartRatio = track.trimStart / duration;
    const trimEndRatio = (track.trimEnd || duration) / duration;
    const threshold = 0.03;

    if (Math.abs(xRatio - trimStartRatio) < threshold) {
      dragRef.current = { type: "start", startX: xRatio, startVal: track.trimStart };
    } else if (Math.abs(xRatio - trimEndRatio) < threshold) {
      dragRef.current = { type: "end", startX: xRatio, startVal: track.trimEnd || duration };
    }
  };

  const handlePointerMove = (e: React.TouchEvent | React.MouseEvent) => {
    const { type } = dragRef.current;
    if (!type) return;
    const duration = track.audioBuffer?.duration || 0;
    const xRatio = getXFromEvent(e);
    const newTime = Math.max(0, Math.min(duration, xRatio * duration));

    if (type === "start" && onTrimChange) {
      const end = track.trimEnd;
      if (newTime < (end || duration) - 0.5) {
        onTrimChange(newTime, end);
      }
    } else if (type === "end" && onTrimChange) {
      if (newTime > track.trimStart + 0.5) {
        onTrimChange(track.trimStart, newTime >= duration - 0.1 ? null : newTime);
      }
    }
  };

  const handlePointerUp = () => {
    dragRef.current = { type: null, startX: 0, startVal: 0 };
  };

  return (
    <div ref={containerRef} className="relative w-full select-none" style={{ height }}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: `${height}px`, borderRadius: "8px", cursor: "ew-resize" }}
        onMouseDown={handlePointerDown}
        onMouseMove={handlePointerMove}
        onMouseUp={handlePointerUp}
        onTouchStart={handlePointerDown}
        onTouchMove={handlePointerMove}
        onTouchEnd={handlePointerUp}
      />
      {!track.audioBuffer && (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg"
          style={{ background: "rgba(17,17,24,0.9)", border: "1px dashed #2a2a3a" }}>
          <span style={{ color: "#4a4a5a", fontSize: 12 }}>波形がここに表示されます</span>
        </div>
      )}
    </div>
  );
}
