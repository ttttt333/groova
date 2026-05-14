import { useState, useEffect } from "react";
import { useGROOVA } from "../lib/store";

type Props = {
  onSync: () => void;
  syncFlash: boolean;
};

export default function MasterBpmBar({ onSync, syncFlash }: Props) {
  const { masterBpm, setMasterBpm, isPlaying } = useGROOVA();
  const [tapTimes, setTapTimes] = useState<number[]>([]);
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState(String(masterBpm));

  useEffect(() => {
    if (!editing) setInputVal(String(masterBpm));
  }, [masterBpm, editing]);

  const handleTap = () => {
    const now = Date.now();
    setTapTimes((prev) => {
      const recent = [...prev.filter((t) => now - t < 3000), now];
      if (recent.length >= 2) {
        const intervals = recent.slice(1).map((t, i) => t - recent[i]);
        const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        const bpm = Math.round(Math.max(40, Math.min(240, 60000 / avg)));
        setMasterBpm(bpm);
      }
      return recent.slice(-8);
    });
  };

  const handleBpmCommit = () => {
    const n = parseFloat(inputVal);
    if (!isNaN(n) && n >= 40 && n <= 240) setMasterBpm(Math.round(n * 10) / 10);
    setEditing(false);
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 12px",
        background: "#0e0e18",
        borderBottom: "1px solid #1a1a24",
        flexShrink: 0,
      }}
    >
      {/* BPM display / edit */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          background: "#0a0a0f",
          border: "1px solid #252535",
          borderRadius: 8,
          padding: "4px 10px",
          flex: 1,
        }}
      >
        <span style={{ fontSize: 10, color: "#4a4a5a", fontFamily: "Space Grotesk", flexShrink: 0 }}>
          BPM
        </span>
        {editing ? (
          <input
            autoFocus
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onBlur={handleBpmCommit}
            onKeyDown={(e) => e.key === "Enter" && handleBpmCommit()}
            style={{
              background: "none",
              border: "none",
              outline: "none",
              fontFamily: "JetBrains Mono, monospace",
              fontWeight: 700,
              fontSize: 20,
              color: "#a8ff3e",
              width: 60,
            }}
          />
        ) : (
          <span
            onClick={() => setEditing(true)}
            style={{
              fontFamily: "JetBrains Mono, monospace",
              fontWeight: 700,
              fontSize: 20,
              color: "#a8ff3e",
              textShadow: "0 0 16px rgba(168,255,62,0.5)",
              cursor: "text",
              minWidth: 60,
            }}
          >
            {masterBpm}
          </span>
        )}

        {/* BPM slider */}
        <input
          type="range"
          className="green"
          min={60}
          max={200}
          step={1}
          value={masterBpm}
          style={{
            flex: 1,
            "--val": `${((masterBpm - 60) / 140) * 100}%`,
          } as any}
          onChange={(e) => setMasterBpm(parseFloat(e.target.value))}
        />

        {/* Beat pulse indicator */}
        <BeatPulse bpm={masterBpm} isPlaying={isPlaying} />
      </div>

      {/* TAP */}
      <button
        onClick={handleTap}
        style={{
          padding: "6px 10px",
          borderRadius: 8,
          background: "#1a1a24",
          border: "1px solid #2a2a3a",
          color: "#9999aa",
          fontFamily: "Space Grotesk, sans-serif",
          fontWeight: 700,
          fontSize: 11,
          cursor: "pointer",
          flexShrink: 0,
          height: 36,
        }}
      >
        TAP
      </button>
    </div>
  );
}

function BeatPulse({ bpm, isPlaying }: { bpm: number; isPlaying: boolean }) {
  const [lit, setLit] = useState(false);

  useEffect(() => {
    const interval = 60000 / bpm;
    const id = setInterval(() => {
      setLit(true);
      setTimeout(() => setLit(false), 80);
    }, interval);
    return () => clearInterval(id);
  }, [bpm]);

  return (
    <div
      style={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: lit ? "#a8ff3e" : "#1a1a24",
        boxShadow: lit ? "0 0 8px #a8ff3e" : "none",
        transition: "background 0.05s, box-shadow 0.05s",
        flexShrink: 0,
      }}
    />
  );
}
