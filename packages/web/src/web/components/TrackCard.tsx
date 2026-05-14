import { useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Music, Zap, Volume2, Trash2, ChevronDown, ChevronUp, Mic2
} from "lucide-react";
import { useGROOVA, TrackState } from "../lib/store";
import { analyzeBPM, decodeAudioFile, extractWaveform } from "../lib/bpmAnalyzer";
import { audioEngine } from "../lib/audioEngine";
import WaveformCanvas from "./WaveformCanvas";

type Props = { track: TrackState; index: number };

export default function TrackCard({ track, index }: Props) {
  const { updateTrack, removeTrack, tracks, syncAllToBpm, masterBpm, setMasterBpm } =
    useGROOVA();
  const fileRef = useRef<HTMLInputElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      updateTrack(track.id, { file, isAnalyzing: true, bpm: null, waveformData: null });
      try {
        const ctx = audioEngine.getContext();
        const audioBuffer = await decodeAudioFile(file, ctx);
        const waveformData = extractWaveform(audioBuffer, 800);

        updateTrack(track.id, { audioBuffer, waveformData });

        // BPM analysis
        const result = await analyzeBPM(audioBuffer);
        updateTrack(track.id, {
          bpm: result.bpm,
          bpmConfidence: result.confidence,
          beatPositions: result.beatPositions,
          isAnalyzing: false,
        });

        // Set master BPM if first track
        if (index === 0) {
          setMasterBpm(result.bpm);
        }
      } catch (err) {
        console.error(err);
        updateTrack(track.id, { isAnalyzing: false });
      }
    },
    [track.id, updateTrack, index, setMasterBpm]
  );

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const speedPct = Math.round((track.speed - 1) * 100);
  const speedLabel =
    track.bpm && masterBpm
      ? `→ ${Math.round(track.bpm * track.speed * 10) / 10} BPM`
      : "";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="rounded-xl overflow-hidden"
      style={{
        background: "#111118",
        border: `1px solid ${track.color}33`,
        boxShadow: `0 0 20px ${track.color}10`,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer"
        style={{ borderBottom: collapsed ? "none" : `1px solid #1a1a24` }}
        onClick={() => setCollapsed(!collapsed)}
      >
        {/* Color dot */}
        <div
          className="w-3 h-3 rounded-full flex-shrink-0"
          style={{ background: track.color, boxShadow: `0 0 8px ${track.color}` }}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              style={{
                fontFamily: "Space Grotesk, sans-serif",
                fontWeight: 600,
                fontSize: 14,
                color: "white",
              }}
            >
              {track.name}
            </span>
            {track.file && (
              <span
                className="truncate max-w-[120px]"
                style={{ fontSize: 11, color: "#9999aa" }}
              >
                {track.file.name}
              </span>
            )}
          </div>
          {track.bpm && (
            <div className="flex items-center gap-2 mt-0.5">
              <span
                style={{
                  fontFamily: "JetBrains Mono, monospace",
                  fontSize: 12,
                  color: track.color,
                  fontWeight: 700,
                }}
                className="text-glow-green"
              >
                {track.bpm} BPM
              </span>
              {speedLabel && (
                <span style={{ fontSize: 10, color: "#9999aa" }}>{speedLabel}</span>
              )}
            </div>
          )}
          {track.isAnalyzing && (
            <div className="flex items-center gap-1 mt-0.5">
              <div
                className="w-1.5 h-1.5 rounded-full animate-pulse"
                style={{ background: "#00f5ff" }}
              />
              <span style={{ fontSize: 11, color: "#00f5ff" }}>BPM解析中...</span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {tracks.length > 1 && (
            <button
              onClick={() => removeTrack(track.id)}
              className="p-1.5 rounded-lg transition-colors"
              style={{ color: "#4a4a5a" }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#ff6b6b")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#4a4a5a")}
            >
              <Trash2 size={14} />
            </button>
          )}
          <button style={{ color: "#4a4a5a" }}>
            {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
        </div>
      </div>

      {/* Body */}
      <AnimatePresence>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="px-4 pb-4 space-y-3"
          >
            {/* Drop zone */}
            <div
              className="mt-3 rounded-lg flex items-center justify-center gap-2 cursor-pointer transition-all"
              style={{
                height: 48,
                background: isDragging ? `${track.color}15` : "#0a0a0f",
                border: `1.5px dashed ${isDragging ? track.color : "#2a2a3a"}`,
              }}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
            >
              <Music size={16} style={{ color: isDragging ? track.color : "#4a4a5a" }} />
              <span style={{ fontSize: 13, color: isDragging ? track.color : "#4a4a5a" }}>
                {track.file ? "別の曲をドロップ" : "曲をドロップ / タップで選択"}
              </span>
              <input
                ref={fileRef}
                type="file"
                accept="audio/*,.mp3,.m4a,.wav,.flac,.ogg,.aac"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
            </div>

            {/* Waveform */}
            <WaveformCanvas
              track={track}
              height={72}
              onTrimChange={(start, end) =>
                updateTrack(track.id, { trimStart: start, trimEnd: end })
              }
            />

            {/* Trim info */}
            {track.audioBuffer && (
              <div className="flex gap-4 text-xs" style={{ color: "#4a4a5a" }}>
                <span>
                  開始:{" "}
                  <span style={{ color: "#9999aa" }}>
                    {track.trimStart.toFixed(2)}s
                  </span>
                </span>
                <span>
                  終了:{" "}
                  <span style={{ color: "#9999aa" }}>
                    {track.trimEnd
                      ? `${track.trimEnd.toFixed(2)}s`
                      : `${track.audioBuffer.duration.toFixed(2)}s`}
                  </span>
                </span>
                <span>
                  長さ:{" "}
                  <span style={{ color: track.color }}>
                    {(
                      (track.trimEnd || track.audioBuffer.duration) - track.trimStart
                    ).toFixed(2)}
                    s
                  </span>
                </span>
              </div>
            )}

            {/* Speed slider */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label style={{ fontSize: 12, color: "#9999aa" }}>速さ</label>
                <span
                  style={{
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: 12,
                    color: track.color,
                  }}
                >
                  {track.speed.toFixed(2)}×
                  {speedPct !== 0 && (
                    <span style={{ color: "#9999aa", marginLeft: 4 }}>
                      ({speedPct > 0 ? "+" : ""}{speedPct}%)
                    </span>
                  )}
                </span>
              </div>
              <input
                type="range"
                className="green"
                min={0.5}
                max={1.5}
                step={0.01}
                value={track.speed}
                style={{ "--val": `${((track.speed - 0.5) / 1) * 100}%` } as any}
                onChange={(e) =>
                  updateTrack(track.id, { speed: parseFloat(e.target.value) })
                }
              />
              <div className="flex justify-between" style={{ fontSize: 10, color: "#4a4a5a" }}>
                <span>0.5×</span>
                <span>1.0×</span>
                <span>1.5×</span>
              </div>
            </div>

            {/* Volume slider */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label style={{ fontSize: 12, color: "#9999aa" }}>音量</label>
                <span
                  style={{
                    fontFamily: "JetBrains Mono, monospace",
                    fontSize: 12,
                    color: "#9999aa",
                  }}
                >
                  {Math.round(track.volume * 100)}%
                </span>
              </div>
              <input
                type="range"
                className="cyan"
                min={0}
                max={1}
                step={0.01}
                value={track.volume}
                style={{ "--val": `${track.volume * 100}%` } as any}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  updateTrack(track.id, { volume: v });
                  audioEngine.updateVolume(track.id, v);
                }}
              />
            </div>

            {/* Mute / Solo */}
            <div className="flex gap-2">
              <button
                onClick={() => updateTrack(track.id, { muted: !track.muted })}
                className="flex-1 py-2 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: track.muted ? "#ff6b2b22" : "#1a1a24",
                  color: track.muted ? "#ff6b2b" : "#4a4a5a",
                  border: `1px solid ${track.muted ? "#ff6b2b44" : "#2a2a3a"}`,
                }}
              >
                {track.muted ? "ミュート中" : "ミュート"}
              </button>
              <button
                onClick={() => {
                  const { setSoloedTrack, soloedTrack } = useGROOVA.getState();
                  setSoloedTrack(soloedTrack === track.id ? null : track.id);
                }}
                className="flex-1 py-2 rounded-lg text-xs font-medium transition-all"
                style={{
                  background: "#1a1a24",
                  color: "#4a4a5a",
                  border: "1px solid #2a2a3a",
                }}
              >
                ソロ
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
