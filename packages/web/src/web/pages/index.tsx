import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play, Square, Pause, Zap, Grid3x3, ZoomIn, ZoomOut,
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
    setPlayheadTime, tracks, showGrid, setShowGrid,
    syncAllToBpm, resetScroll,
  } = useGROOVA();

  // playheadTime は store から subscribe しない — DOM直接更新で60fps再レンダリングを回避
  const playheadTimeRef = useRef(0);
  const timeDisplayRefs = useRef<(HTMLSpanElement | null)[]>([]);

  // audioEngine から rAF で直接読んで表示だけ更新
  useEffect(() => {
    let rafId: number;
    const tick = () => {
      const t = audioEngine.getCurrentTime();
      playheadTimeRef.current = t;
      const str = formatTime(t);
      timeDisplayRefs.current.forEach((el) => { if (el) el.textContent = str; });
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const [sheet, setSheet] = useState<BottomSheet>(null);
  const [syncFlash, setSyncFlash] = useState(false);
  const isLandscape = useIsLandscape();

  const lastPlayTap = useRef(0);
  const handlePlay = () => {
    const now = Date.now();
    if (now - lastPlayTap.current < 300) return;
    lastPlayTap.current = now;

    if (isPlaying) {
      // 再生中 → 一時停止（現在位置保持）
      audioEngine.pause();
      setIsPlaying(false);
    } else {
      audioEngine.unlockContext();
      audioEngine.play(playheadTimeRef.current);
      setIsPlaying(true);
    }
  };

  /** 一時停止（現在位置保持） */
  const handlePause = () => {
    audioEngine.pause();
    setIsPlaying(false);
  };

  /** 頭出し停止（先頭に戻る） */
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
          gap: isLandscape ? 8 : 0,
          justifyContent: "space-between",
          padding: isLandscape ? "5px 10px" : "77px 16px 12px",
          background: "rgba(10,10,15,0.95)",
          borderBottom: "1px solid #1a1a24",
          flexShrink: 0,
          zIndex: 10,
        }}
      >
        {/* ロゴ */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <div
            style={{
              width: isLandscape ? 22 : 28, height: isLandscape ? 22 : 28, borderRadius: 8,
              background: "linear-gradient(135deg, #a8ff3e, #00f5ff)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            <span style={{ fontWeight: 900, fontSize: isLandscape ? 11 : 14, color: "#000", fontFamily: "Space Grotesk" }}>G</span>
          </div>
          {!isLandscape && (
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
          )}
        </div>

        {/* 横向き時: BPMバーをヘッダー内にインライン表示 */}
        {isLandscape && (
          <MasterBpmBar onSync={handleSync} syncFlash={syncFlash} isLandscape={true} inline={true} />
        )}

        <button
          onClick={() => toggleSheet("export")}
          style={{
            padding: isLandscape ? "4px 10px" : "6px 16px",
            borderRadius: 999,
            background: "linear-gradient(135deg, #a8ff3e, #00f5ff)",
            border: "none", color: "#000",
            fontFamily: "Space Grotesk, sans-serif",
            fontWeight: 700, fontSize: 12, cursor: "pointer",
            display: "flex", alignItems: "center", gap: 4,
            flexShrink: 0,
          }}
        >
          <Download size={12} />
          {!isLandscape && "書き出し"}
          {isLandscape && "書き出し"}
        </button>
      </header>

      {/* ── Master BPM bar (縦向き時のみ) ── */}
      {!isLandscape && (
        <MasterBpmBar onSync={handleSync} syncFlash={syncFlash} isLandscape={false} />
      )}

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
          {/* ⏮ 頭出し */}
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

          {/* ⏸ 一時停止（再生中のみ表示） */}
          {isPlaying && (
            <button
              onClick={handlePause}
              style={{
                width: btnH, height: btnH, borderRadius: btnR, flexShrink: 0,
                background: "linear-gradient(135deg, #ff6b2b44, #ff6b2b22)",
                border: "1.5px solid #ff6b2b88",
                color: "#ff6b2b",
                display: "flex", alignItems: "center",
                justifyContent: "center", cursor: "pointer",
              }}
            >
              <Pause size={14} fill="currentColor" />
            </button>
          )}

          {/* ▶ 再生 */}
          <button
            onClick={handlePlay}
            style={{
              width: isPlaying ? btnH : 80, height: btnH, borderRadius: btnR, flexShrink: 0,
              background: isPlaying
                ? "linear-gradient(135deg, #ffffff22, #ffffff11)"
                : "linear-gradient(135deg, #a8ff3e33, #a8ff3e11)",
              border: `1.5px solid ${isPlaying ? "#33334488" : "#a8ff3e66"}`,
              color: isPlaying ? "#9999aa" : "#a8ff3e",
              fontFamily: "Space Grotesk, sans-serif",
              fontWeight: 700, fontSize: 12,
              display: "flex", alignItems: "center",
              justifyContent: "center", gap: 5, cursor: "pointer",
            }}
          >
            {isPlaying ? <Play size={12} /> : <><Play size={12} fill="currentColor" /> 再生</>}
          </button>

          {/* 時間 */}
          <span
            ref={(el) => { timeDisplayRefs.current[0] = el; }}
            style={{
              fontFamily: "JetBrains Mono, monospace",
              fontSize: 12, color: "#a8ff3e", fontWeight: 700,
              minWidth: 72, flexShrink: 0,
            }}
          >
            0:00.0
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
            animate={syncFlash ? { scale: [1, 1.08, 1] } : {}}
            transition={{ duration: 0.25 }}
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
              <span
                ref={(el) => { timeDisplayRefs.current[1] = el; }}
                style={{
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: 13, color: "#a8ff3e", fontWeight: 700,
                }}
              >
                0:00.0
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
              {/* ⏮ 頭出し */}
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

              {/* ⏸ 一時停止（再生中のみ） */}
              {isPlaying && (
                <button
                  onClick={handlePause}
                  style={{
                    width: btnH, height: btnH, borderRadius: btnR, flexShrink: 0,
                    background: "linear-gradient(135deg, #ff6b2b44, #ff6b2b22)",
                    border: "1.5px solid #ff6b2b88",
                    color: "#ff6b2b",
                    display: "flex", alignItems: "center",
                    justifyContent: "center", cursor: "pointer",
                  }}
                >
                  <Pause size={16} fill="currentColor" />
                </button>
              )}

              {/* ▶ 再生 */}
              <button
                onClick={handlePlay}
                style={{
                  flex: 1, height: btnH, borderRadius: btnR,
                  background: isPlaying
                    ? "linear-gradient(135deg, #ffffff11, #ffffff08)"
                    : "linear-gradient(135deg, #a8ff3e33, #a8ff3e11)",
                  border: `1.5px solid ${isPlaying ? "#33334488" : "#a8ff3e66"}`,
                  color: isPlaying ? "#9999aa" : "#a8ff3e",
                  fontFamily: "Space Grotesk, sans-serif",
                  fontWeight: 700, fontSize: 14,
                  display: "flex", alignItems: "center",
                  justifyContent: "center", gap: 6, cursor: "pointer",
                }}
              >
                {isPlaying ? <Play size={14} /> : <><Play size={14} fill="currentColor" /> 再生</>}
              </button>

              <motion.button
                onClick={handleSync}
                disabled={!hasAudio}
                animate={syncFlash ? { scale: [1, 1.08, 1] } : {}}
                transition={{ duration: 0.25 }}
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
                width: "100%",
                background: "#111118",
                borderRadius: "20px 20px 0 0",
                border: "1px solid #1a1a24", borderBottom: "none",
                zIndex: 50, maxHeight: "70vh", overflowY: "auto",
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

// ── BPM調整シート ──
function MasterBpmEditor({ masterBpm, setMasterBpm }: { masterBpm: number; setMasterBpm: (v: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(masterBpm));
  useEffect(() => { if (!editing) setVal(String(masterBpm)); }, [masterBpm, editing]);
  const commit = () => {
    const n = parseFloat(val);
    if (!isNaN(n) && n >= 40 && n <= 240) setMasterBpm(Math.round(n * 10) / 10);
    setEditing(false);
  };
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "10px 14px", borderRadius: 10, marginBottom: 14,
      background: "linear-gradient(135deg, #a8ff3e18, #00f5ff10)",
      border: "1px solid #a8ff3e33",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "linear-gradient(135deg, #a8ff3e, #00f5ff)" }} />
        <span style={{ fontFamily: "Space Grotesk", fontSize: 13, color: "#a0a0c0", fontWeight: 600 }}>
          マスター BPM
        </span>
      </div>
      {editing ? (
        <input
          autoFocus
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && commit()}
          style={{
            background: "none", border: "none", outline: "none",
            fontFamily: "JetBrains Mono, monospace", fontSize: 18, fontWeight: 700,
            color: "#a8ff3e", width: 64, textAlign: "right",
          }}
        />
      ) : (
        <span
          onClick={() => setEditing(true)}
          style={{
            fontFamily: "JetBrains Mono, monospace", fontSize: 18, fontWeight: 700,
            background: "linear-gradient(135deg, #a8ff3e, #00f5ff)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            cursor: "text",
          }}
        >
          {masterBpm}
        </span>
      )}
    </div>
  );
}

function BpmInfoSheet({ tracks, masterBpm }: { tracks: import("../lib/store").TrackState[]; masterBpm: number }) {
  const { updateTrack, setMasterBpm } = useGROOVA();

  // masterBpm を ref で保持（updateDom クロージャ内で最新値を参照するため）
  const masterBpmRef = useRef(masterBpm);
  useEffect(() => { masterBpmRef.current = masterBpm; }, [masterBpm]);

  // 初期 targetBpm を一度だけ計算
  const targetBpmsRef = useRef<Record<string, number>>({});
  // マウント時のみ初期化（以降は applyBpm で更新）
  useEffect(() => {
    const init: Record<string, number> = {};
    for (const t of tracks) {
      if (t.bpm && t.bpm > 0) {
        init[t.id] = Math.round((t.bpm * (t.speed ?? 1)) * 10) / 10;
      }
    }
    targetBpmsRef.current = init;
    // DOM も初期値で更新
    for (const t of tracks) {
      if (t.bpm && t.bpm > 0) {
        updateDom(t.id, targetBpmsRef.current[t.id]);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // DOM refs — 各トラックの表示要素を直接更新
  const domRefs = useRef<Record<string, {
    bpmText: HTMLElement | null;
    diffBadge: HTMLElement | null;
    speedBadge: HTMLElement | null;
    bar: HTMLElement | null;
    slider: HTMLInputElement | null;
    card: HTMLElement | null;
    resetBtn: HTMLElement | null;
  }>>({});

  // store 書き込み debounce（audio は即時、store は 200ms 後）
  const storeTimerRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const commitToStore = useCallback((trackId: string, newSpeed: number) => {
    if (storeTimerRef.current[trackId]) clearTimeout(storeTimerRef.current[trackId]);
    storeTimerRef.current[trackId] = setTimeout(() => {
      updateTrack(trackId, { speed: newSpeed });
    }, 200);
  }, [updateTrack]);

  // DOM 直接更新（再レンダリングなし）— masterBpmRef 経由で常に最新値を参照
  const updateDom = useCallback((trackId: string, clamped: number) => {
    const track = useGROOVA.getState().tracks.find((t) => t.id === trackId);
    if (!track?.bpm) return;
    const originalBpm = track.bpm;
    const isChanged = Math.abs(clamped - originalBpm) > 0.05;
    const speedRatio = clamped / originalBpm;
    const diffFromMaster = Math.round((clamped - masterBpmRef.current) * 10) / 10;
    const diffColor = Math.abs(diffFromMaster) < 1 ? "#a8ff3e" : Math.abs(diffFromMaster) < 5 ? "#ffcc44" : "#ff6b44";
    const refs = domRefs.current[trackId];
    if (!refs) return;

    if (refs.bpmText) {
      refs.bpmText.textContent = clamped.toFixed(1);
      refs.bpmText.style.background = isChanged
        ? "linear-gradient(135deg, #a8ff3e, #00f5ff)"
        : "linear-gradient(135deg, #8888aa, #6666aa)";
    }
    if (refs.diffBadge) {
      refs.diffBadge.textContent = `${diffFromMaster >= 0 ? "+" : ""}${diffFromMaster} vs master`;
      refs.diffBadge.style.color = diffColor;
      refs.diffBadge.style.borderColor = `${diffColor}44`;
      refs.diffBadge.style.background = `${diffColor}18`;
    }
    if (refs.speedBadge) refs.speedBadge.textContent = `${speedRatio.toFixed(3)}×`;
    if (refs.bar) {
      refs.bar.style.width = `${((clamped - 40) / (300 - 40)) * 100}%`;
      refs.bar.style.background = isChanged ? "linear-gradient(90deg, #a8ff3e, #00f5ff)" : "#3a3a4a";
    }
    if (refs.slider) refs.slider.value = String(clamped);
    if (refs.card) refs.card.style.borderColor = isChanged ? "#a8ff3e33" : "#2a2a3a";
    if (refs.resetBtn) refs.resetBtn.style.display = isChanged ? "block" : "none";
  }, []); // masterBpmRef で参照するためクロージャ依存なし

  // masterBpm 変更時 → 全トラックの diff バッジを即時再計算
  useEffect(() => {
    for (const t of tracks) {
      const cur = targetBpmsRef.current[t.id];
      if (cur !== undefined) updateDom(t.id, cur);
    }
  }, [masterBpm, updateDom]); // eslint-disable-line react-hooks/exhaustive-deps

  const applyBpm = useCallback((trackId: string, newTargetBpm: number) => {
    const track = useGROOVA.getState().tracks.find((t) => t.id === trackId);
    if (!track?.bpm) return;
    const clamped = Math.min(300, Math.max(40, Math.round(newTargetBpm * 10) / 10));
    const newSpeed = clamped / track.bpm;
    targetBpmsRef.current[trackId] = clamped;
    // 音声は即時
    audioEngine.updateSpeed(trackId, newSpeed);
    // store は debounce
    commitToStore(trackId, newSpeed);
    // DOM は即時
    updateDom(trackId, clamped);
  }, [commitToStore, updateDom]);

  const handleReset = useCallback((trackId: string) => {
    const track = useGROOVA.getState().tracks.find((t) => t.id === trackId);
    if (!track?.bpm) return;
    const original = Math.round(track.bpm * 10) / 10;
    targetBpmsRef.current[trackId] = original;
    audioEngine.updateSpeed(trackId, 1);
    commitToStore(trackId, 1);
    updateDom(trackId, original);
  }, [commitToStore, updateDom]);

  const holdRef = useRef<{ timeout: ReturnType<typeof setTimeout> | null; interval: ReturnType<typeof setInterval> | null }>({ timeout: null, interval: null });

  const stopHold = useCallback(() => {
    if (holdRef.current.timeout) { clearTimeout(holdRef.current.timeout); holdRef.current.timeout = null; }
    if (holdRef.current.interval) { clearInterval(holdRef.current.interval); holdRef.current.interval = null; }
  }, []);

  const startHold = useCallback((trackId: string, delta: number) => {
    stopHold();
    // 即時1回
    const cur0 = targetBpmsRef.current[trackId];
    if (cur0 !== undefined) applyBpm(trackId, cur0 + delta);
    // 300ms後に連続 — 間隔 80ms
    holdRef.current.timeout = setTimeout(() => {
      holdRef.current.interval = setInterval(() => {
        const cur = targetBpmsRef.current[trackId];
        if (cur !== undefined) applyBpm(trackId, cur + delta);
      }, 80);
    }, 300);
  }, [applyBpm, stopHold]);

  const audioTracks = tracks.filter((t) => t.audioBuffer && t.bpm && t.bpm > 0);

  const BpmStepBtn = ({
    label, trackId, delta,
  }: { label: string; trackId: string; delta: number }) => (
    <button
      onPointerDown={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "#2a2a40";
        e.currentTarget.setPointerCapture(e.pointerId);
        startHold(trackId, delta);
      }}
      onPointerUp={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "#1e1e2e";
        stopHold();
      }}
      onPointerLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "#1e1e2e";
        stopHold();
      }}
      onPointerCancel={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "#1e1e2e";
        stopHold();
      }}
      style={{
        flex: 1, padding: "12px 0", borderRadius: 8,
        background: "#1e1e2e", border: "1px solid #2e2e44",
        color: "#c0c0d8", fontFamily: "JetBrains Mono", fontSize: 15, fontWeight: 700,
        cursor: "pointer", userSelect: "none", WebkitUserSelect: "none",
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
        minHeight: 48,
      }}
    >
      {label}
    </button>
  );

  return (
    <div>
      {/* ヘッダー */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <Gauge size={16} color="#a8ff3e" />
        <span style={{ fontFamily: "Space Grotesk", fontWeight: 700, fontSize: 15, color: "#e0e0ff" }}>
          BPM 調整
        </span>
      </div>

      {/* マスターBPM — タップで編集可能 */}
      <MasterBpmEditor masterBpm={masterBpm} setMasterBpm={setMasterBpm} />

      {/* トラック一覧 */}
      {audioTracks.length === 0 ? (
        <p style={{ textAlign: "center", color: "#333355", fontSize: 12, fontFamily: "Space Grotesk", marginTop: 12 }}>
          音声をロードするとBPMが表示されます
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {tracks.map((track, i) => {
            if (!track.audioBuffer || !track.bpm || track.bpm === 0) return null;
            const originalBpm = track.bpm;
            const initTarget = targetBpmsRef.current[track.id] ?? Math.round(originalBpm * 10) / 10;
            const initChanged = Math.abs(initTarget - originalBpm) > 0.05;
            const initSpeedRatio = initTarget / originalBpm;
            const initDiff = Math.round((initTarget - masterBpm) * 10) / 10;
            const initDiffColor = Math.abs(initDiff) < 1 ? "#a8ff3e" : Math.abs(initDiff) < 5 ? "#ffcc44" : "#ff6b44";

            // domRefs 初期化
            if (!domRefs.current[track.id]) {
              domRefs.current[track.id] = { bpmText: null, diffBadge: null, speedBadge: null, bar: null, slider: null, card: null, resetBtn: null };
            }

            return (
              <div
                key={track.id}
                ref={(el) => { if (domRefs.current[track.id]) domRefs.current[track.id].card = el; }}
                style={{
                  padding: "14px", borderRadius: 14,
                  background: "#1a1a28", border: `1px solid ${initChanged ? "#a8ff3e33" : "#2a2a3a"}`,
                }}
              >
                {/* トラック名行 */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <div style={{
                    width: 20, height: 20, borderRadius: 5, flexShrink: 0,
                    background: "#2a2a40", display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 10, color: "#6666aa", fontFamily: "JetBrains Mono", fontWeight: 700,
                  }}>
                    {i + 1}
                  </div>
                  <span style={{
                    fontFamily: "Space Grotesk", fontSize: 12, fontWeight: 600,
                    color: "#c0c0d8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    flex: 1,
                  }}>
                    {track.name}
                  </span>
                  <span style={{ fontSize: 10, color: "#44445a", fontFamily: "JetBrains Mono", flexShrink: 0 }}>
                    元 {originalBpm.toFixed(1)}
                  </span>
                </div>

                {/* ── 現在BPM 大表示 ── */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 12 }}>
                  <div style={{ textAlign: "center" }}>
                    <div
                      ref={(el) => { if (domRefs.current[track.id]) domRefs.current[track.id].bpmText = el; }}
                      style={{
                        fontFamily: "JetBrains Mono, monospace", fontSize: 42, fontWeight: 700, lineHeight: 1,
                        background: initChanged
                          ? "linear-gradient(135deg, #a8ff3e, #00f5ff)"
                          : "linear-gradient(135deg, #8888aa, #6666aa)",
                        WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
                      }}>
                      {initTarget.toFixed(1)}
                    </div>
                    <div style={{ fontFamily: "Space Grotesk", fontSize: 10, color: "#44445a", marginTop: 2 }}>
                      BPM
                    </div>
                  </div>
                  {/* バッジ列 */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div
                      ref={(el) => { if (domRefs.current[track.id]) domRefs.current[track.id].diffBadge = el; }}
                      style={{
                        padding: "3px 8px", borderRadius: 6,
                        background: `${initDiffColor}18`, border: `1px solid ${initDiffColor}44`,
                        fontSize: 10, fontFamily: "JetBrains Mono", fontWeight: 700, color: initDiffColor,
                        textAlign: "center",
                      }}>
                      {initDiff >= 0 ? `+${initDiff}` : `${initDiff}`} vs master
                    </div>
                    <div
                      ref={(el) => { if (domRefs.current[track.id]) domRefs.current[track.id].speedBadge = el; }}
                      style={{
                        padding: "3px 8px", borderRadius: 6,
                        background: "#2a2a3a",
                        fontSize: 10, fontFamily: "JetBrains Mono", fontWeight: 700,
                        color: "#6666aa", textAlign: "center",
                      }}>
                      {initSpeedRatio.toFixed(3)}×
                    </div>
                  </div>
                </div>

                {/* ── ±ボタン行 ── */}
                <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                  <BpmStepBtn label="−1" trackId={track.id} delta={-1} />
                  <BpmStepBtn label="−0.1" trackId={track.id} delta={-0.1} />
                  <BpmStepBtn label="+0.1" trackId={track.id} delta={+0.1} />
                  <BpmStepBtn label="+1" trackId={track.id} delta={+1} />
                </div>

                {/* ── スライダー (補助) ── */}
                <div style={{ position: "relative" }}>
                  <div style={{
                    position: "absolute", top: "50%", left: 0, right: 0,
                    height: 3, borderRadius: 999, background: "#2a2a3a",
                    transform: "translateY(-50%)", pointerEvents: "none",
                  }} />
                  <div
                    ref={(el) => { if (domRefs.current[track.id]) domRefs.current[track.id].bar = el; }}
                    style={{
                      position: "absolute", top: "50%", left: 0,
                      height: 3, borderRadius: 999,
                      background: initChanged ? "linear-gradient(90deg, #a8ff3e, #00f5ff)" : "#3a3a4a",
                      transform: "translateY(-50%)",
                      width: `${((initTarget - 40) / (300 - 40)) * 100}%`,
                      pointerEvents: "none",
                    }} />
                  <input
                    ref={(el) => { if (domRefs.current[track.id]) domRefs.current[track.id].slider = el; }}
                    type="range" min={40} max={300} step={0.5}
                    defaultValue={initTarget}
                    onChange={(e) => applyBpm(track.id, parseFloat(e.target.value))}
                    style={{
                      width: "100%", height: 24,
                      appearance: "none", WebkitAppearance: "none",
                      background: "transparent", cursor: "pointer",
                      position: "relative", zIndex: 1,
                    }}
                  />
                </div>

                {/* ── 目盛り + リセット ── */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                  {[
                    { bpm: Math.max(40, originalBpm * 0.5), label: "×0.5" },
                    { bpm: originalBpm, label: "元" },
                    { bpm: Math.min(300, originalBpm * 2), label: "×2" },
                  ].map(({ bpm, label }) => (
                    <button
                      key={label}
                      onPointerDown={(e) => { e.preventDefault(); applyBpm(track.id, Math.round(bpm * 10) / 10); }}
                      style={{
                        background: "none", border: "none", padding: "6px 4px",
                        color: "#444466",
                        fontSize: 9, fontFamily: "Space Grotesk", fontWeight: 600, cursor: "pointer",
                        touchAction: "manipulation", minHeight: 36,
                      }}
                    >
                      {label}<br />
                      <span style={{ fontFamily: "JetBrains Mono", fontSize: 9 }}>{bpm.toFixed(0)}</span>
                    </button>
                  ))}
                  <button
                    ref={(el) => { if (domRefs.current[track.id]) domRefs.current[track.id].resetBtn = el; }}
                    onPointerDown={(e) => { e.preventDefault(); handleReset(track.id); }}
                    style={{
                      padding: "3px 10px", borderRadius: 6,
                      background: "#2a1a1a", border: "1px solid #ff6b4433",
                      color: "#ff6b44", fontSize: 10,
                      fontFamily: "Space Grotesk", fontWeight: 600,
                      cursor: "pointer",
                      display: initChanged ? "block" : "none",
                      touchAction: "manipulation",
                    }}
                  >
                    リセット
                  </button>
                </div>
              </div>
            );
          })}
        </div>
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
