import React from "react";
import { useGROOVA } from "../lib/store";

interface Props {
  onClose: () => void;
}

export default function TrackSettingsSheet({ onClose }: Props) {
  const tracks = useGROOVA((s) => s.tracks);
  const updateTrack = useGROOVA((s) => s.updateTrack);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <span className="text-sm font-semibold text-white tracking-wide">Track Settings</span>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-full bg-white/10 text-white/70 hover:bg-white/20 text-xs"
        >
          ✕
        </button>
      </div>

      {/* Track list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {tracks.length === 0 && (
          <p className="text-white/40 text-xs text-center mt-6">No tracks loaded yet.</p>
        )}
        {tracks.map((track, i) => (
          <div key={track.id} className="bg-white/5 rounded-xl p-3 space-y-3">
            {/* Track label row */}
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ background: TRACK_COLORS[i % TRACK_COLORS.length] }}
              />
              <span className="text-xs font-medium text-white truncate flex-1">
                {track.file?.name || track.name || `Track ${i + 1}`}
              </span>
              <button
                onClick={() => updateTrack(track.id, { muted: !track.muted })}
                className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                  track.muted
                    ? "border-red-500/60 text-red-400 bg-red-500/10"
                    : "border-white/20 text-white/50 bg-transparent"
                }`}
              >
                {track.muted ? "MUTED" : "LIVE"}
              </button>
            </div>

            {/* Volume */}
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-white/40">
                <span>Volume</span>
                <span>{Math.round((track.volume ?? 1) * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={track.volume ?? 1}
                onChange={(e) =>
                  updateTrack(track.id, { volume: parseFloat(e.target.value) })
                }
                className="w-full accent-purple-500 h-1"
              />
            </div>

            {/* Speed */}
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-white/40">
                <span>Speed</span>
                <span>{(track.speed ?? 1).toFixed(2)}×</span>
              </div>
              <input
                type="range"
                min={0.25}
                max={2}
                step={0.05}
                value={track.speed ?? 1}
                onChange={(e) =>
                  updateTrack(track.id, { speed: parseFloat(e.target.value) })
                }
                className="w-full accent-pink-500 h-1"
              />
            </div>

            {/* Trim start */}
            <div className="space-y-1">
              <div className="flex justify-between text-[10px] text-white/40">
                <span>Trim Start</span>
                <span>{(track.trimStart ?? 0).toFixed(2)}s</span>
              </div>
              <input
                type="range"
                min={0}
                max={track.audioBuffer ? Math.max(0, track.audioBuffer.duration - 0.1) : 30}
                step={0.1}
                value={track.trimStart ?? 0}
                onChange={(e) =>
                  updateTrack(track.id, { trimStart: parseFloat(e.target.value) })
                }
                className="w-full accent-cyan-500 h-1"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const TRACK_COLORS = [
  "#a855f7",
  "#ec4899",
  "#06b6d4",
  "#f59e0b",
  "#10b981",
  "#f43f5e",
];
