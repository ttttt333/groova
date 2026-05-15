import { useState, useEffect, useRef } from "react";
import { useGROOVA } from "../lib/store";
import { audioEngine } from "../lib/audioEngine";

type Props = {
  onSync: () => void;
  syncFlash: boolean;
  isLandscape?: boolean;
  /** ヘッダー内にインライン埋め込みする場合 true — ラッパーdivなしでflex childrenのみ返す */
  inline?: boolean;
};

export default function MasterBpmBar({ onSync, syncFlash, isLandscape, inline }: Props) {
  // tracks は selector で最小化（配列の参照が毎回変わっても再レンダリングしない）
  const masterBpm = useGROOVA((s) => s.masterBpm);
  const setMasterBpm = useGROOVA((s) => s.setMasterBpm);
  const isPlaying = useGROOVA((s) => s.isPlaying);
  // tracks は speed 更新のためだけに使う — BPM変更時のみ反応すればOKなので
  // tracks を直接 subscribe せず store.getState() で取得してレンダリングを減らす
  const [tapTimes, setTapTimes] = useState<number[]>([]);
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState(String(masterBpm));

  // 再生中にBPM変更 → 即座にplaybackRate更新（tracks を subscribe しない）
  useEffect(() => {
    if (!isPlaying) return;
    const tracks = useGROOVA.getState().tracks;
    const speeds: Record<string, number> = {};
    tracks.forEach((t) => {
      if (t.bpm && t.bpm > 0) {
        speeds[t.id] = masterBpm / t.bpm;
      }
    });
    audioEngine.updateAllSpeeds(speeds);
  }, [masterBpm, isPlaying]);

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

  const bpmBox = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        background: "#0a0a0f",
        border: "1px solid #252535",
        borderRadius: 8,
        padding: inline ? "3px 8px" : "4px 10px",
        flex: 1,
        minWidth: 0,
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
            fontSize: inline ? 14 : isLandscape ? 16 : 20,
            color: "#a8ff3e",
            width: inline ? 36 : isLandscape ? 44 : 60,
          }}
        />
      ) : (
        <span
          onClick={() => setEditing(true)}
          style={{
            fontFamily: "JetBrains Mono, monospace",
            fontWeight: 700,
            fontSize: inline ? 14 : isLandscape ? 16 : 20,
            color: "#a8ff3e",
            textShadow: "0 0 16px rgba(168,255,62,0.5)",
            cursor: "text",
            minWidth: inline ? 36 : isLandscape ? 44 : 60,
          }}
        >
          {masterBpm}
        </span>
      )}

      {/* BPM slider — インライン時は非表示 */}
      {!inline && (
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
      )}

      {/* Beat pulse indicator */}
      <BeatPulse bpm={masterBpm} />
    </div>
  );

  const tapBtn = (
    <button
      onClick={handleTap}
      style={{
        padding: inline ? "4px 8px" : "6px 10px",
        borderRadius: 8,
        background: "#1a1a24",
        border: "1px solid #2a2a3a",
        color: "#9999aa",
        fontFamily: "Space Grotesk, sans-serif",
        fontWeight: 700,
        fontSize: 11,
        cursor: "pointer",
        flexShrink: 0,
        height: inline ? 28 : 36,
      }}
    >
      TAP
    </button>
  );

  if (inline) {
    // ヘッダー内インライン: ラッパーなし、flex: 1 で残り幅を使う
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
        {bpmBox}
        {tapBtn}
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: isLandscape ? "4px 12px" : "10px 14px",
        background: "#0e0e18",
        borderBottom: "1px solid #1a1a24",
        flexShrink: 0,
      }}
    >
      {bpmBox}
      {tapBtn}
    </div>
  );
}

// BeatPulse — state なし。DOM を直接操作して再レンダリングゼロ
function BeatPulse({ bpm }: { bpm: number }) {
  const dotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interval = 60000 / bpm;
    let timeoutId: ReturnType<typeof setTimeout>;
    const id = setInterval(() => {
      if (dotRef.current) {
        dotRef.current.style.background = "#a8ff3e";
        dotRef.current.style.boxShadow = "0 0 8px #a8ff3e";
      }
      timeoutId = setTimeout(() => {
        if (dotRef.current) {
          dotRef.current.style.background = "#1a1a24";
          dotRef.current.style.boxShadow = "none";
        }
      }, 80);
    }, interval);
    return () => {
      clearInterval(id);
      clearTimeout(timeoutId);
    };
  }, [bpm]);

  return (
    <div
      ref={dotRef}
      style={{
        width: 8, height: 8, borderRadius: "50%",
        background: "#1a1a24", boxShadow: "none",
        transition: "background 0.05s, box-shadow 0.05s",
        flexShrink: 0,
      }}
    />
  );
}
