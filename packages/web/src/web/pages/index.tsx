import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play, Square, Zap, Grid3x3, ZoomIn, ZoomOut,
  Download, Sparkles, Music2, Plus, ChevronDown,
  SkipBack, Volume2
} from "lucide-react";
import { useGROOVA } from "../lib/store";
import { audioEngine } from "../lib/audioEngine";
import Timeline from "../components/Timeline";
import MasterBpmBar from "../components/MasterBpmBar";
import FXPanel from "../components/FXPanel";
import SFXPanel from "../components/SFXPanel";
import ExportPanel from "../components/ExportPanel";
import TrackSettingsSheet from "../components/TrackSettingsSheet";

type BottomSheet = "fx" | "sfx" | "export" | "settings" | null;

export default function GROOVAApp() {
  const {
    isPlaying, setIsPlaying, masterBpm, zoomLevel, setZoom,
    playheadTime, setPlayheadTime, tracks, showGrid, setShowGrid,
    syncAllToBpm,
  } = useGROOVA();

  const [sheet, setSheet] = useState<BottomSheet>(null);
  const [syncFlash, setSyncFlash] = useState(false);
  const [debugLog, setDebugLog] = useState<string[]>([]);

  // audioEngineのログをUI上に表示
  useEffect(() => {
    audioEngine.onDebugLog = (msg: string) => {
      const time = new Date().toISOString().slice(11, 23);
      setDebugLog(prev => [`[${time}] ${msg}`, ...prev].slice(0, 10));
    };
    return () => { audioEngine.onDebugLog = null; };
  }, []);

  const lastPlayTap = useRef(0);
  const handlePlay = () => {
    // 300ms以内の連続タップを無視（iOSの二重発火対策）
    const now = Date.now();
    if (now - lastPlayTap.current < 300) return;
    lastPlayTap.current = now;

    if (isPlaying) {
      audioEngine.stop();
      setIsPlaying(false);
    } else {
      audioEngine.unlockContext();
      audioEngine.play(playheadTime);
      setIsPlaying(true);
    }
  };

  const handleStop = () => {
    audioEngine.stop();
    setIsPlaying(false);
    setPlayheadTime(0);
  };

  const handleSync = () => {
    syncAllToBpm();
    setSyncFlash(true);
    if ("vibrate" in navigator) navigator.vibrate([20, 10, 20]);
    setTimeout(() => setSyncFlash(false), 600);
  };

  const toggleSheet = (s: BottomSheet) => setSheet((prev) => (prev === s ? null : s));

  const hasAudio = tracks.some((t) => t.audioBuffer);

  return (
    <div
      style={{
        background: "#0a0a0f",
        width: "100%",
        maxWidth: 480,
        margin: "0 auto",
        height: "100dvh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* ── Header ── */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px 8px",
          background: "rgba(10,10,15,0.95)",
          borderBottom: "1px solid #1a1a24",
          flexShrink: 0,
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: "linear-gradient(135deg, #a8ff3e, #00f5ff)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span style={{ fontWeight: 900, fontSize: 14, color: "#000", fontFamily: "Space Grotesk" }}>G</span>
          </div>
          <span
            style={{
              fontFamily: "Space Grotesk, sans-serif",
              fontWeight: 800,
              fontSize: 20,
              letterSpacing: -0.5,
              background: "linear-gradient(135deg, #a8ff3e, #00f5ff)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            GROOVA
          </span>
        </div>

        {/* Export button — CapCut style */}
        <button
          onClick={() => toggleSheet("export")}
          style={{
            padding: "6px 16px",
            borderRadius: 999,
            background: "linear-gradient(135deg, #a8ff3e, #00f5ff)",
            border: "none",
            color: "#000",
            fontFamily: "Space Grotesk, sans-serif",
            fontWeight: 700,
            fontSize: 13,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <Download size={13} />
          書き出し
        </button>
      </header>

      {/* ── DEBUG PANEL (一時的) ── */}
      {debugLog.length > 0 && (
        <div
          style={{
            background: "#0a0a0f",
            borderBottom: "1px solid #1a1a24",
            padding: "4px 10px",
            flexShrink: 0,
          }}
          onClick={() => setDebugLog([])}
        >
          {debugLog.map((l, i) => (
            <div key={i} style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 9, color: i === 0 ? "#a8ff3e" : "#444466", lineHeight: 1.5 }}>
              {l}
            </div>
          ))}
        </div>
      )}

      {/* ── Master BPM bar ── */}
      <MasterBpmBar onSync={handleSync} syncFlash={syncFlash} />

      {/* ── Timeline (main area, fills remaining space) ── */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <Timeline />
      </div>

      {/* ── Transport bar ── */}
      <div
        style={{
          flexShrink: 0,
          background: "#0e0e18",
          borderTop: "1px solid #1a1a24",
          padding: "8px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {/* Playhead time + zoom */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span
            style={{
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 13,
              color: "#a8ff3e",
              fontWeight: 700,
            }}
          >
            {formatTime(playheadTime)}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {/* Grid toggle */}
            <button
              onClick={() => setShowGrid(!showGrid)}
              style={{
                padding: "4px 8px",
                borderRadius: 6,
                background: showGrid ? "#a8ff3e15" : "#1a1a24",
                border: `1px solid ${showGrid ? "#a8ff3e44" : "#2a2a3a"}`,
                color: showGrid ? "#a8ff3e" : "#4a4a5a",
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: 10,
                cursor: "pointer",
                fontFamily: "Space Grotesk, sans-serif",
                fontWeight: 600,
              }}
            >
              <Grid3x3 size={11} />
              8カウント
            </button>
            {/* Zoom */}
            <button
              onClick={() => setZoom(Math.max(0.5, zoomLevel - 0.5))}
              style={{ padding: 5, background: "#1a1a24", border: "1px solid #2a2a3a", borderRadius: 6, color: "#9999aa", cursor: "pointer" }}
            >
              <ZoomOut size={13} />
            </button>
            <span style={{ fontSize: 10, color: "#4a4a5a", minWidth: 30, textAlign: "center", fontFamily: "JetBrains Mono" }}>
              {zoomLevel.toFixed(1)}×
            </span>
            <button
              onClick={() => setZoom(Math.min(8, zoomLevel + 0.5))}
              style={{ padding: 5, background: "#1a1a24", border: "1px solid #2a2a3a", borderRadius: 6, color: "#9999aa", cursor: "pointer" }}
            >
              <ZoomIn size={13} />
            </button>
          </div>
        </div>

        {/* Transport buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Return to start */}
          <button
            onClick={handleStop}
            style={{
              width: 40, height: 40, borderRadius: 10,
              background: "#1a1a24", border: "1px solid #2a2a3a",
              color: "#9999aa", display: "flex", alignItems: "center",
              justifyContent: "center", cursor: "pointer", flexShrink: 0,
            }}
          >
            <SkipBack size={16} />
          </button>

          {/* Play / Pause */}
          <motion.button
            onClick={handlePlay}
            whileTap={{ scale: 0.93 }}
            style={{
              flex: 1, height: 40, borderRadius: 10,
              background: isPlaying
                ? "linear-gradient(135deg, #ff6b2b44, #ff6b2b22)"
                : "linear-gradient(135deg, #ffffff22, #ffffff11)",
              border: `1.5px solid ${isPlaying ? "#ff6b2b88" : "#333344"}`,
              color: isPlaying ? "#ff6b2b" : "white",
              fontFamily: "Space Grotesk, sans-serif",
              fontWeight: 700, fontSize: 14,
              display: "flex", alignItems: "center",
              justifyContent: "center", gap: 6, cursor: "pointer",
            }}
          >
            {isPlaying ? <><Square size={14} fill="currentColor" /> 停止</> : <><Play size={14} fill="currentColor" /> 再生</>}
          </motion.button>

          {/* SYNC */}
          <motion.button
            onClick={handleSync}
            disabled={!hasAudio}
            whileTap={{ scale: 0.93 }}
            animate={syncFlash ? { scale: [1, 1.08, 1] } : {}}
            style={{
              width: 56, height: 40, borderRadius: 10, flexShrink: 0,
              background: syncFlash
                ? "linear-gradient(135deg, #a8ff3e, #00f5ff)"
                : hasAudio ? "#a8ff3e22" : "#0a0a0f",
              border: `1.5px solid ${hasAudio ? "#a8ff3e66" : "#1a1a24"}`,
              color: hasAudio ? "#a8ff3e" : "#2a2a3a",
              display: "flex", flexDirection: "column", alignItems: "center",
              justifyContent: "center", cursor: hasAudio ? "pointer" : "default",
              gap: 1,
            }}
          >
            <Zap size={15} style={{ fill: hasAudio && !syncFlash ? "#a8ff3e" : syncFlash ? "#000" : "#2a2a3a" }}
              color={syncFlash ? "#000" : undefined} />
            <span style={{ fontSize: 8, fontFamily: "Space Grotesk", fontWeight: 700,
              color: syncFlash ? "#000" : hasAudio ? "#a8ff3e" : "#2a2a3a" }}>
              SYNC
            </span>
          </motion.button>
        </div>
      </div>

      {/* ── Bottom toolbar (CapCut-style tool row) ── */}
      <div
        style={{
          flexShrink: 0,
          background: "#0a0a0f",
          borderTop: "1px solid #1a1a24",
          display: "flex",
          alignItems: "center",
          overflowX: "auto",
          gap: 4,
          padding: "6px 8px",
          paddingBottom: "calc(6px + env(safe-area-inset-bottom, 0px))",
        }}
      >
        {[
          { id: "fx" as const, label: "FX", icon: <Sparkles size={18} /> },
          { id: "sfx" as const, label: "効果音", icon: <Music2 size={18} /> },
          { id: "settings" as const, label: "設定", icon: <Volume2 size={18} /> },
        ].map((tool) => (
          <button
            key={tool.id}
            onClick={() => toggleSheet(tool.id)}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 3,
              padding: "6px 14px",
              borderRadius: 8,
              background: sheet === tool.id ? "#a8ff3e15" : "none",
              border: `1px solid ${sheet === tool.id ? "#a8ff3e44" : "transparent"}`,
              color: sheet === tool.id ? "#a8ff3e" : "#666677",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            {tool.icon}
            <span style={{ fontSize: 10, fontFamily: "Space Grotesk", fontWeight: 600 }}>
              {tool.label}
            </span>
          </button>
        ))}
      </div>

      {/* ── Bottom Sheets ── */}
      <AnimatePresence>
        {sheet && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSheet(null)}
              style={{
                position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
                zIndex: 40,
              }}
            />
            {/* Sheet */}
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 300 }}
              style={{
                position: "fixed",
                bottom: 0,
                left: "50%",
                transform: "translateX(-50%)",
                width: "100%",
                maxWidth: 480,
                background: "#111118",
                borderRadius: "20px 20px 0 0",
                border: "1px solid #1a1a24",
                borderBottom: "none",
                zIndex: 50,
                maxHeight: "60vh",
                overflowY: "auto",
              }}
            >
              {/* Handle */}
              <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 4px" }}>
                <div style={{ width: 36, height: 4, borderRadius: 999, background: "#2a2a3a" }} />
              </div>
              <div style={{ padding: "4px 16px 24px" }}>
                {sheet === "fx" && <FXPanel />}
                {sheet === "sfx" && <SFXPanel />}
                {sheet === "export" && <ExportPanel />}
                {sheet === "settings" && <TrackSettingsSheet />}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 100);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(2, "0")}`;
}
