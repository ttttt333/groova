import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Zap, RefreshCw, Grid3x3 } from "lucide-react";
import { useGROOVA } from "../lib/store";
import { audioEngine } from "../lib/audioEngine";

export default function MasterPanel() {
  const {
    masterBpm,
    setMasterBpm,
    isPlaying,
    setIsPlaying,
    syncAllToBpm,
    tracks,
    setShowGrid,
    showGrid,
    setSnapToGrid,
    snapToGrid,
  } = useGROOVA();

  const [bpmInput, setBpmInput] = useState(String(masterBpm));
  const [syncFlash, setSyncFlash] = useState(false);
  const [tapTimes, setTapTimes] = useState<number[]>([]);
  const pulseRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>();
  const bpmRafRef = useRef<number | null>(null);
  const pendingBpmRef = useRef<number | null>(null);

  // BPM pulse animation
  useEffect(() => {
    setBpmInput(String(masterBpm));
    const interval = 60000 / masterBpm;

    const pulse = () => {
      if (pulseRef.current) {
        pulseRef.current.style.opacity = "0.15";
        setTimeout(() => {
          if (pulseRef.current) pulseRef.current.style.opacity = "0.03";
        }, 80);
      }
    };

    const id = setInterval(pulse, interval);
    return () => clearInterval(id);
  }, [masterBpm]);

  // BPM変更を rAF で throttle — スライダー操作中の過剰な store 更新を防ぐ
  const flushBpm = (val: number) => {
    bpmRafRef.current = null;
    pendingBpmRef.current = null;
    setMasterBpm(val);
    // 再生中なら全トラックの playbackRate をリアルタイム更新
    const { tracks, isPlaying } = useGROOVA.getState();
    if (isPlaying) {
      const speeds: Record<string, number> = {};
      tracks.forEach((t) => {
        if (t.bpm && t.bpm > 0) speeds[t.id] = val / t.bpm;
      });
      audioEngine.updateAllSpeeds(speeds);
    }
  };

  const handleBpmChange = (val: string) => {
    setBpmInput(val);
    const n = parseFloat(val);
    if (isNaN(n) || n < 40 || n > 240) return;
    pendingBpmRef.current = n;
    if (!bpmRafRef.current) {
      bpmRafRef.current = requestAnimationFrame(() => {
        if (pendingBpmRef.current !== null) flushBpm(pendingBpmRef.current);
      });
    }
  };

  const handlePlay = async () => {
    if (isPlaying) {
      audioEngine.stop();
      setIsPlaying(false);
    } else {
      await audioEngine.resumeContext();
      audioEngine.play(0);
      setIsPlaying(true);
    }
  };

  const handleSync = () => {
    syncAllToBpm();
    setSyncFlash(true);
    setTimeout(() => setSyncFlash(false), 600);

    // Haptic
    if ("vibrate" in navigator) navigator.vibrate([20, 10, 20]);
  };

  // Tap tempo
  const handleTap = () => {
    const now = Date.now();
    setTapTimes((prev) => {
      const recent = [...prev.filter((t) => now - t < 3000), now];
      if (recent.length >= 2) {
        const intervals = recent.slice(1).map((t, i) => t - recent[i]);
        const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const bpm = Math.round(60000 / avg);
        setMasterBpm(Math.max(40, Math.min(240, bpm)));
      }
      return recent.slice(-8);
    });
  };

  const hasAnyTrack = tracks.some((t) => t.audioBuffer);

  return (
    <div
      className="relative overflow-hidden rounded-2xl"
      style={{
        background: "#111118",
        border: "1px solid #252535",
      }}
    >
      {/* BPM pulse background */}
      <div
        ref={pulseRef}
        className="absolute inset-0 pointer-events-none transition-opacity duration-75"
        style={{
          background: "radial-gradient(circle at 50% 50%, #a8ff3e 0%, transparent 70%)",
          opacity: 0.03,
        }}
      />

      <div className="relative p-4 space-y-4">
        {/* BPM Row */}
        <div className="flex items-center gap-3">
          {/* BPM Display */}
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-xl"
            style={{ background: "#0a0a0f", border: "1px solid #252535", flex: 1 }}
          >
            <span style={{ fontSize: 11, color: "#4a4a5a", flexShrink: 0 }}>BPM</span>
            <input
              type="number"
              min={40}
              max={240}
              step={0.1}
              value={bpmInput}
              onChange={(e) => handleBpmChange(e.target.value)}
              style={{
                background: "none",
                border: "none",
                outline: "none",
                fontFamily: "JetBrains Mono, monospace",
                fontSize: 24,
                fontWeight: 700,
                color: "#a8ff3e",
                textShadow: "0 0 20px rgba(168,255,62,0.6)",
                width: "80px",
              }}
            />
            <input
              type="range"
              className="green"
              min={60}
              max={200}
              step={1}
              value={masterBpm}
              style={{ "--val": `${((masterBpm - 60) / 140) * 100}%`, flex: 1 } as any}
              onChange={(e) => handleBpmChange(e.target.value)}
            />
          </div>

          {/* Tap tempo */}
          <button
            onClick={handleTap}
            className="px-3 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95"
            style={{
              background: "#1a1a24",
              color: "#9999aa",
              border: "1px solid #252535",
              minWidth: 52,
              height: 52,
            }}
          >
            TAP
          </button>
        </div>

        {/* Sync button */}
        <motion.button
          onClick={handleSync}
          disabled={!hasAnyTrack}
          whileTap={{ scale: 0.96 }}
          className="w-full py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all"
          style={{
            background: syncFlash
              ? "linear-gradient(135deg, #a8ff3e, #00f5ff)"
              : hasAnyTrack
              ? "linear-gradient(135deg, #a8ff3e22, #a8ff3e11)"
              : "#0a0a0f",
            border: `1.5px solid ${hasAnyTrack ? "#a8ff3e66" : "#1a1a24"}`,
            color: hasAnyTrack ? "#a8ff3e" : "#2a2a3a",
            fontFamily: "Space Grotesk, sans-serif",
            fontSize: 15,
            boxShadow: syncFlash ? "0 0 30px rgba(168,255,62,0.5)" : "none",
          }}
          animate={syncFlash ? { scale: [1, 1.02, 1] } : {}}
        >
          <Zap size={16} style={{ fill: hasAnyTrack ? "#a8ff3e" : "#2a2a3a" }} />
          SYNC
        </motion.button>

        {/* Play / Stop */}
        <div className="flex gap-2">
          <motion.button
            onClick={handlePlay}
            whileTap={{ scale: 0.95 }}
            className="flex-1 py-3 rounded-xl font-bold text-sm transition-all"
            style={{
              background: isPlaying
                ? "linear-gradient(135deg, #ff6b2b33, #ff6b2b11)"
                : "linear-gradient(135deg, #ffffff22, #ffffff11)",
              border: `1.5px solid ${isPlaying ? "#ff6b2b66" : "#252535"}`,
              color: isPlaying ? "#ff6b2b" : "white",
              fontFamily: "Space Grotesk, sans-serif",
            }}
          >
            {isPlaying ? "■ 停止" : "▶ 再生"}
          </motion.button>
        </div>

        {/* Grid toggles */}
        <div className="flex gap-2">
          <button
            onClick={() => setShowGrid(!showGrid)}
            className="flex-1 py-2 rounded-lg text-xs flex items-center justify-center gap-1.5 transition-all"
            style={{
              background: showGrid ? "#a8ff3e15" : "#0a0a0f",
              border: `1px solid ${showGrid ? "#a8ff3e44" : "#1a1a24"}`,
              color: showGrid ? "#a8ff3e" : "#4a4a5a",
            }}
          >
            <Grid3x3 size={12} />
            8カウントグリッド
          </button>
          <button
            onClick={() => setSnapToGrid(!snapToGrid)}
            className="flex-1 py-2 rounded-lg text-xs flex items-center justify-center gap-1.5 transition-all"
            style={{
              background: snapToGrid ? "#00f5ff15" : "#0a0a0f",
              border: `1px solid ${snapToGrid ? "#00f5ff44" : "#1a1a24"}`,
              color: snapToGrid ? "#00f5ff" : "#4a4a5a",
            }}
          >
            <RefreshCw size={12} />
            スナップ
          </button>
        </div>
      </div>
    </div>
  );
}
