import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play, Square, Zap, Grid3x3, ZoomIn, ZoomOut,
  Download, Sparkles, Music2, SkipBack, Volume2, Gauge
} from "lucide-react";
import { useGROOVA } from "../lib/store";
import { audioEngine } from "../lib/audioEngine";
import Timeline from "../components/Timeline";
import MasterBpmBar from "../components/MasterBpmBar";
import FXPanel from "../components/FXPanel";
import SFXPanel from "../components/SFXPanel";
import ExportPanel from "../components/ExportPanel";
import TrackSettingsSheet from "../components/TrackSettingsSheet";

type BottomSheet = "fx" | "sfx" | "export" | "settings" | "bpm" | null;

/** 画面の向きを監視 */
function useIsLandscape() {
  const [landscape, setLandscape] = useState(
    () => window.innerWidth > window.innerHeight
  );
  useEffect(() => {
    const update = () => setLandscape(window.innerWidth > window.innerHeight);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);
  return landscape;
}

export default function GROOVAApp() {
  const {
    isPlaying, setIsPlaying, masterBpm, zoomLevel, setZoom,
    playheadTime, setPlayheadTime, tracks, showGrid, setShowGrid,
    syncAllToBpm, resetScroll,
  } = useGROOVA();

  const [sheet, setSheet] = useState<BottomSheet>(null);
  const [syncFlash, setSyncFlash] = useState(false);
  const isLandscape = useIsLandscape();

  const lastPlayTap = useRef(0);
  const handlePlay = () => {
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
    resetScroll();
  };

  const handleSync = () => {
    syncAllToBpm();
    setSyncFlash(true);
    if ("vibrate" in navigator) navigator.vibrate([20, 10, 20]);
    setTimeout(() => setSyncFlash(false), 600);
  };

  const toggleSheet = (s: BottomSheet) => setSheet((prev) => (prev === s ? null : s));
  const hasAudio = tracks.some((t) => t.audioBuffer);

  // ズームステップ（適応的）
  const zoomStep = (cur: number) =>
    cur < 1 ? 0.25 : cur < 4 ? 0.5 : cur < 16 ? 2 : 4;

  // ボタン高さ: 横画面で小さく
  const btnH = isLandscape ? 32 : 40;
  const btnR = isLandscape ? 8 : 10;

  return (
    <div
      style={{
        background: "#0a0a0f",
        width: "100%",
        maxWidth: isLandscape ? "100%" : 480,
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
          padding: isLandscape ? "6px 14px" : "77px 16px 12px",
          background: "rgba(10,10,15,0.95)",
          borderBottom: "1px solid #1a1a24",
          flexShrink: 0,
          zIndex: 10,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 28, height: 28, borderRadius: 8,
              background: "linear-gradient(135deg, #a8ff3e, #00f5ff)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <span style={{ fontWeight: 900, fontSize: 14, color: "#000", fontFamily: "Space Grotesk" }}>G</span>
          </div>
          <span
            style={{
              fontFamily: "Space Grotesk, sans-serif",
              fontWeight: 800,
              fontSize: isLandscape ? 16 : 20,
              letterSpacing: -0.5,
              background: "linear-gradient(135deg, #a8ff3e, #00f5ff)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            GROOVA
          </span>
        </div>

        <button
          onClick={() => toggleSheet("export")}
          style={{
            padding: isLandscape ? "4px 12px" : "6px 16px",
            borderRadius: 999,
            background: "linear-gradient(135deg, #a8ff3e, #00f5ff)",
            border: "none", color: "#000",
            fontFamily: "Space Grotesk, sans-serif",
            fontWeight: 700, fontSize: 13, cursor: "pointer",
            display: "flex", alignItems: "center", gap: 5,
          }}
        >
          <Download size={13} />
          書き出し
        </button>
      </header>

      {/* ── Master BPM bar ── */}
      <MasterBpmBar onSync={handleSync} syncFlash={syncFlash} isLandscape={isLandscape} />

      {/* ── Timeline ── */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <Timeline />
      </div>

      {/* ── Transport bar ── */}
      {isLandscape ? (
        /* 横画面: 全部1行 */
        <div
          style={{
            flexShrink: 0,
            background: "#0e0e18",
            borderTop: "1px solid #1a1a24",
            padding: "5px 10px",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {/* ⏮ */}
          <button
            onClick={handleStop}
            style={{
              width: btnH, height: btnH, borderRadius: btnR,
              background: "#1a1a24", border: "1px solid #2a2a3a",
              color: "#9999aa", display: "flex", alignItems: "center",
              justifyContent: "center", cursor: "pointer", flexShrink: 0,
            }}
          >
            <SkipBack size={14} />
          </button>

          {/* ▶ / ■ */}
          <motion.button
            onClick={handlePlay}
            whileTap={{ scale: 0.93 }}
            style={{
              width: 80, height: btnH, borderRadius: btnR, flexShrink: 0,
              background: isPlaying
                ? "linear-gradient(135deg, #ff6b2b44, #ff6b2b22)"
                : "linear-gradient(135deg, #ffffff22, #ffffff11)",
              border: `1.5px solid ${isPlaying ? "#ff6b2b88" : "#333344"}`,
              color: isPlaying ? "#ff6b2b" : "white",
              fontFamily: "Space Grotesk, sans-serif",
              fontWeight: 700, fontSize: 12,
              display: "flex", alignItems: "center",
              justifyContent: "center", gap: 5, cursor: "pointer",
            }}
          >
            {isPlaying ? <><Square size={12} fill="currentColor" /> 停止</> : <><Play size={12} fill="currentColor" /> 再生</>}
          </motion.button>

          {/* 時間 */}
          <span style={{
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 12, color: "#a8ff3e", fontWeight: 700,
            minWidth: 72, flexShrink: 0,
          }}>
            {formatTime(playheadTime)}
          </span>

          {/* spacer */}
          <div style={{ flex: 1 }} />

          {/* グリッド */}
          <button
            onClick={() => setShowGrid(!showGrid)}
            style={{
              height: btnH, padding: "0 8px", borderRadius: btnR,
              background: showGrid ? "#a8ff3e15" : "#1a1a24",
              border: `1px solid ${showGrid ? "#a8ff3e44" : "#2a2a3a"}`,
              color: showGrid ? "#a8ff3e" : "#4a4a5a",
              display: "flex", alignItems: "center", gap: 3,
              fontSize: 10, cursor: "pointer",
              fontFamily: "Space Grotesk, sans-serif", fontWeight: 600,
            }}
          >
            <Grid3x3 size={10} />
            8カウント
          </button>

          {/* ズーム */}
          <button
            onClick={() => setZoom(Math.max(0.25, zoomLevel - zoomStep(zoomLevel)))}
            style={{ padding: 4, background: "#1a1a24", border: "1px solid #2a2a3a", borderRadius: btnR, color: "#9999aa", cursor: "pointer" }}
          >
            <ZoomOut size={12} />
          </button>
          <span style={{ fontSize: 10, color: "#4a4a5a", minWidth: 32, textAlign: "center", fontFamily: "JetBrains Mono" }}>
            {zoomLevel < 10 ? zoomLevel.toFixed(1) : Math.round(zoomLevel)}×
          </span>
          <button
            onClick={() => setZoom(Math.min(64, zoomLevel + zoomStep(zoomLevel)))}
            style={{ padding: 4, background: "#1a1a24", border: "1px solid #2a2a3a", borderRadius: btnR, color: "#9999aa", cursor: "pointer" }}
          >
            <ZoomIn size={12} />
          </button>

          {/* SYNC */}
          <motion.button
            onClick={handleSync}
            disabled={!hasAudio}
            whileTap={{ scale: 0.93 }}
            animate={syncFlash ? { scale: [1, 1.08, 1] } : {}}
            style={{
              width: 48, height: btnH, borderRadius: btnR, flexShrink: 0,
              background: syncFlash ? "linear-gradient(135deg, #a8ff3e, #00f5ff)" : hasAudio ? "#a8ff3e22" : "#0a0a0f",
              border: `1.5px solid ${hasAudio ? "#a8ff3e66" : "#1a1a24"}`,
              color: hasAudio ? "#a8ff3e" : "#2a2a3a",
              display: "flex", flexDirection: "column", alignItems: "center",
              justifyContent: "center", cursor: hasAudio ? "pointer" : "default", gap: 1,
            }}
          >
            <Zap size={13} style={{ fill: hasAudio && !syncFlash ? "#a8ff3e" : syncFlash ? "#000" : "#2a2a3a" }}
              color={syncFlash ? "#000" : undefined} />
            <span style={{ fontSize: 7, fontFamily: "Space Grotesk", fontWeight: 700,
              color: syncFlash ? "#000" : hasAudio ? "#a8ff3e" : "#2a2a3a" }}>SYNC</span>
          </motion.button>

          {/* ツールボタン群 */}
          {[
            { id: "fx" as const, label: "FX", icon: <Sparkles size={14} /> },
            { id: "sfx" as const, label: "効果音", icon: <Music2 size={14} /> },
            { id: "settings" as const, label: "設定", icon: <Volume2 size={14} /> },
            { id: "bpm" as const, label: "BPM確認", icon: <Gauge size={14} /> },
          ].map((tool) => (
            <button
              key={tool.id}
              onClick={() => toggleSheet(tool.id)}
              style={{
                height: btnH, padding: "0 10px",
                display: "flex", flexDirection: "column", alignItems: "center",
                justifyContent: "center", gap: 2,
                borderRadius: btnR,
                background: sheet === tool.id ? "#a8ff3e15" : "#1a1a24",
                border: `1px solid ${sheet === tool.id ? "#a8ff3e44" : "#2a2a3a"}`,
                color: sheet === tool.id ? "#a8ff3e" : "#666677",
                cursor: "pointer", flexShrink: 0,
              }}
            >
              {tool.icon}
              <span style={{ fontSize: 8, fontFamily: "Space Grotesk", fontWeight: 600 }}>{tool.label}</span>
            </button>
          ))}
        </div>
      ) : (
        /* 縦画面: 2段 */
        <>
          <div
            style={{
              flexShrink: 0,
              background: "#0e0e18",
              borderTop: "1px solid #1a1a24",
              padding: "10px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {/* 時間 + ズーム */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{
                fontFamily: "JetBrains Mono, monospace",
                fontSize: 13, color: "#a8ff3e", fontWeight: 700,
              }}>
                {formatTime(playheadTime)}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button
                  onClick={() => setShowGrid(!showGrid)}
                  style={{
                    padding: "4px 8px", borderRadius: 6,
                    background: showGrid ? "#a8ff3e15" : "#1a1a24",
                    border: `1px solid ${showGrid ? "#a8ff3e44" : "#2a2a3a"}`,
                    color: showGrid ? "#a8ff3e" : "#4a4a5a",
                    display: "flex", alignItems: "center", gap: 4,
                    fontSize: 10, cursor: "pointer",
                    fontFamily: "Space Grotesk, sans-serif", fontWeight: 600,
                  }}
                >
                  <Grid3x3 size={11} />
                  8カウント
                </button>
                <button
                  onClick={() => setZoom(Math.max(0.25, zoomLevel - zoomStep(zoomLevel)))}
                  style={{ padding: 5, background: "#1a1a24", border: "1px solid #2a2a3a", borderRadius: 6, color: "#9999aa", cursor: "pointer" }}
                >
                  <ZoomOut size={13} />
                </button>
                <span style={{ fontSize: 10, color: "#4a4a5a", minWidth: 36, textAlign: "center", fontFamily: "JetBrains Mono" }}>
                  {zoomLevel < 10 ? zoomLevel.toFixed(1) : Math.round(zoomLevel)}×
                </span>
                <button
                  onClick={() => setZoom(Math.min(64, zoomLevel + zoomStep(zoomLevel)))}
                  style={{ padding: 5, background: "#1a1a24", border: "1px solid #2a2a3a", borderRadius: 6, color: "#9999aa", cursor: "pointer" }}
                >
                  <ZoomIn size={13} />
                </button>
              </div>
            </div>

            {/* トランスポートボタン */}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                onClick={handleStop}
                style={{
                  width: btnH, height: btnH, borderRadius: btnR,
                  background: "#1a1a24", border: "1px solid #2a2a3a",
                  color: "#9999aa", display: "flex", alignItems: "center",
                  justifyContent: "center", cursor: "pointer", flexShrink: 0,
                }}
              >
                <SkipBack size={16} />
              </button>

              <motion.button
                onClick={handlePlay}
                whileTap={{ scale: 0.93 }}
                style={{
                  flex: 1, height: btnH, borderRadius: btnR,
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

              <motion.button
                onClick={handleSync}
                disabled={!hasAudio}
                whileTap={{ scale: 0.93 }}
                animate={syncFlash ? { scale: [1, 1.08, 1] } : {}}
                style={{
                  width: 56, height: btnH, borderRadius: btnR, flexShrink: 0,
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

          {/* ── Bottom toolbar ── */}
          <div
            style={{
              flexShrink: 0,
              background: "#0a0a0f",
              borderTop: "1px solid #1a1a24",
              display: "flex",
              alignItems: "center",
              overflowX: "auto",
              gap: 4,
              padding: "10px 8px",
              paddingBottom: "calc(10px + env(safe-area-inset-bottom, 0px))",
            }}
          >
            {[
              { id: "fx" as const, label: "FX", icon: <Sparkles size={18} /> },
              { id: "sfx" as const, label: "効果音", icon: <Music2 size={18} /> },
              { id: "settings" as const, label: "設定", icon: <Volume2 size={18} /> },
              { id: "bpm" as const, label: "BPM確認", icon: <Gauge size={18} /> },
            ].map((tool) => (
              <button
                key={tool.id}
                onClick={() => toggleSheet(tool.id)}
                style={{
                  display: "flex", flexDirection: "column",
                  alignItems: "center", gap: 3,
                  padding: "6px 14px", borderRadius: 8,
                  background: sheet === tool.id ? "#a8ff3e15" : "none",
                  border: `1px solid ${sheet === tool.id ? "#a8ff3e44" : "transparent"}`,
                  color: sheet === tool.id ? "#a8ff3e" : "#666677",
                  cursor: "pointer", flexShrink: 0,
                }}
              >
                {tool.icon}
                <span style={{ fontSize: 10, fontFamily: "Space Grotesk", fontWeight: 600 }}>
                  {tool.label}
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* ── Bottom Sheets ── */}
      <AnimatePresence>
        {sheet && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setSheet(null)}
              style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 40 }}
            />
            <motion.div
              initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 28, stiffness: 300 }}
              style={{
                position: "fixed", bottom: 0, left: 0, right: 0,
                margin: "0 auto",
                width: "100%", maxWidth: 480,
                background: "#111118",
                borderRadius: "20px 20px 0 0",
                border: "1px solid #1a1a24", borderBottom: "none",
                zIndex: 50, maxHeight: "60vh", overflowY: "auto",
              }}
            >
              <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 4px" }}>
                <div style={{ width: 36, height: 4, borderRadius: 999, background: "#2a2a3a" }} />
              </div>
              <div style={{ padding: "4px 16px 24px" }}>
                {sheet === "fx" && <FXPanel />}
                {sheet === "sfx" && <SFXPanel />}
                {sheet === "export" && <ExportPanel />}
                {sheet === "settings" && <TrackSettingsSheet />}
                {sheet === "bpm" && <BpmInfoSheet tracks={tracks} masterBpm={masterBpm} />}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── BPM一覧シート ──
function BpmInfoSheet({ tracks, masterBpm }: { tracks: import("../lib/store").TrackState[]; masterBpm: number }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <Gauge size={16} color="#a8ff3e" />
        <span style={{ fontFamily: "Space Grotesk", fontWeight: 700, fontSize: 15, color: "#e0e0ff" }}>
          BPM 確認
        </span>
      </div>

      {/* マスターBPM */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px", borderRadius: 10, marginBottom: 8,
        background: "linear-gradient(135deg, #a8ff3e18, #00f5ff10)",
        border: "1px solid #a8ff3e33",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "linear-gradient(135deg, #a8ff3e, #00f5ff)" }} />
          <span style={{ fontFamily: "Space Grotesk", fontSize: 13, color: "#a0a0c0", fontWeight: 600 }}>
            マスター BPM
          </span>
        </div>
        <span style={{
          fontFamily: "JetBrains Mono, monospace", fontSize: 18, fontWeight: 700,
          background: "linear-gradient(135deg, #a8ff3e, #00f5ff)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
        }}>
          {masterBpm}
        </span>
      </div>

      {/* 各トラック */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {tracks.map((track, i) => {
          const hasBpm = track.bpm && track.bpm > 0;
          const confidence = Math.round((track.bpmConfidence ?? 0) * 100);
          const diff = hasBpm ? Math.round((track.bpm! - masterBpm) * 10) / 10 : null;
          const diffColor = diff === null ? "#555" : Math.abs(diff) < 1 ? "#a8ff3e" : Math.abs(diff) < 5 ? "#ffcc44" : "#ff6b44";

          return (
            <div
              key={track.id}
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "9px 14px", borderRadius: 10,
                background: "#1a1a28",
                border: "1px solid #2a2a3a",
                opacity: track.audioBuffer ? 1 : 0.45,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                {/* 番号バッジ */}
                <div style={{
                  width: 22, height: 22, borderRadius: 6, flexShrink: 0,
                  background: "#2a2a40",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 11, color: "#6666aa", fontFamily: "JetBrains Mono", fontWeight: 700,
                }}>
                  {i + 1}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontFamily: "Space Grotesk", fontSize: 12, fontWeight: 600,
                    color: "#c0c0d8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    maxWidth: 130,
                  }}>
                    {track.name}
                  </div>
                  {hasBpm && (
                    <div style={{ fontSize: 10, color: "#555577", fontFamily: "Space Grotesk", marginTop: 1 }}>
                      確度 {confidence}%
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
                {/* 差分バッジ */}
                {diff !== null && (
                  <div style={{
                    padding: "2px 7px", borderRadius: 5,
                    background: `${diffColor}18`,
                    border: `1px solid ${diffColor}44`,
                    fontSize: 10, fontFamily: "JetBrains Mono", fontWeight: 700,
                    color: diffColor,
                  }}>
                    {diff >= 0 ? `+${diff}` : `${diff}`}
                  </div>
                )}
                {/* BPM値 */}
                <span style={{
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: 16, fontWeight: 700,
                  color: hasBpm ? "#e0e0ff" : "#333355",
                  minWidth: 52, textAlign: "right",
                }}>
                  {hasBpm ? track.bpm!.toFixed(1) : "—"}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {tracks.every((t) => !t.audioBuffer) && (
        <p style={{ textAlign: "center", color: "#333355", fontSize: 12, fontFamily: "Space Grotesk", marginTop: 12 }}>
          音声をロードするとBPMが表示されます
        </p>
      )}
    </div>
  );
}

function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.floor((sec % 1) * 100);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(2, "0")}`;
}
