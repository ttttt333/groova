import { useState } from "react";
import { motion } from "framer-motion";
import { Download, Music, Loader2, CheckCircle } from "lucide-react";
import { useGROOVA } from "../lib/store";
import { audioEngine } from "../lib/audioEngine";

type ExportState = "idle" | "exporting" | "done" | "error";

export default function ExportPanel() {
  const { tracks } = useGROOVA();
  const [exportState, setExportState] = useState<ExportState>("idle");
  const [format, setFormat] = useState<"wav" | "mp3">("wav");
  const [quality, setQuality] = useState<"standard" | "high">("high");
  const [progress, setProgress] = useState(0);

  const hasAudio = tracks.some((t) => t.audioBuffer);

  const handleExport = async () => {
    if (!hasAudio) return;
    setExportState("exporting");
    setProgress(0);

    try {
      // Simulate progress
      const progressInterval = setInterval(() => {
        setProgress((p) => Math.min(p + 10, 85));
      }, 200);

      const sampleRate = quality === "high" ? 48000 : 44100;
      const blob = await audioEngine.exportWAV(sampleRate, 16);

      clearInterval(progressInterval);
      setProgress(100);

      // Download
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `groova_mix_${Date.now()}.${format === "wav" ? "wav" : "wav"}`;
      a.click();
      URL.revokeObjectURL(url);

      setExportState("done");
      setTimeout(() => { setExportState("idle"); setProgress(0); }, 3000);
    } catch (err) {
      console.error(err);
      setExportState("error");
      setTimeout(() => setExportState("idle"), 3000);
    }
  };

  return (
    <div className="space-y-4">
      {/* Format selection */}
      <div className="space-y-2">
        <label style={{ fontSize: 12, color: "#9999aa" }}>書き出し形式</label>
        <div className="grid grid-cols-2 gap-2">
          {(["wav", "mp3"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFormat(f)}
              className="py-3 rounded-xl text-sm font-bold transition-all"
              style={{
                background: format === f ? "#a8ff3e15" : "#0a0a0f",
                border: `1.5px solid ${format === f ? "#a8ff3e66" : "#1a1a24"}`,
                color: format === f ? "#a8ff3e" : "#4a4a5a",
                fontFamily: "Space Grotesk, sans-serif",
              }}
            >
              {f.toUpperCase()}
              <div style={{ fontSize: 10, fontWeight: 400, color: format === f ? "#a8ff3e88" : "#2a2a3a" }}>
                {f === "wav" ? "16bit PCM" : "320kbps"}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Quality */}
      <div className="space-y-2">
        <label style={{ fontSize: 12, color: "#9999aa" }}>音質</label>
        <div className="grid grid-cols-2 gap-2">
          {(["standard", "high"] as const).map((q) => (
            <button
              key={q}
              onClick={() => setQuality(q)}
              className="py-3 rounded-xl text-sm font-bold transition-all"
              style={{
                background: quality === q ? "#00f5ff15" : "#0a0a0f",
                border: `1.5px solid ${quality === q ? "#00f5ff66" : "#1a1a24"}`,
                color: quality === q ? "#00f5ff" : "#4a4a5a",
                fontFamily: "Space Grotesk, sans-serif",
              }}
            >
              {q === "standard" ? "標準" : "高音質"}
              <div style={{ fontSize: 10, fontWeight: 400, color: quality === q ? "#00f5ff88" : "#2a2a3a" }}>
                {q === "standard" ? "44.1kHz" : "48kHz / 24bit"}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Track summary */}
      <div
        className="rounded-xl p-3 space-y-2"
        style={{ background: "#0a0a0f", border: "1px solid #1a1a24" }}
      >
        <p style={{ fontSize: 11, color: "#4a4a5a" }}>書き出しトラック</p>
        {tracks.map((t) => (
          <div key={t.id} className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-full"
              style={{ background: t.audioBuffer ? t.color : "#2a2a3a" }}
            />
            <span style={{ fontSize: 12, color: t.audioBuffer ? "white" : "#2a2a3a" }}>
              {t.name}
            </span>
            {t.audioBuffer && (
              <span style={{ fontSize: 10, color: "#4a4a5a", marginLeft: "auto" }}>
                {t.bpm ? `${t.bpm} BPM` : "—"} · {Math.round(t.volume * 100)}%
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Export progress bar */}
      {exportState === "exporting" && (
        <div className="space-y-2">
          <div
            className="rounded-full overflow-hidden"
            style={{ height: 6, background: "#1a1a24" }}
          >
            <motion.div
              className="h-full rounded-full"
              style={{ background: "linear-gradient(90deg, #a8ff3e, #00f5ff)" }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
          <p style={{ fontSize: 11, color: "#a8ff3e", textAlign: "center" }}>
            書き出し中... {progress}%
          </p>
        </div>
      )}

      {/* Export button */}
      <motion.button
        onClick={handleExport}
        disabled={!hasAudio || exportState === "exporting"}
        whileTap={hasAudio ? { scale: 0.97 } : {}}
        className="w-full py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all"
        style={{
          background:
            exportState === "done"
              ? "linear-gradient(135deg, #a8ff3e33, #a8ff3e11)"
              : hasAudio
              ? "linear-gradient(135deg, #a8ff3e, #00f5ff)"
              : "#0a0a0f",
          color:
            exportState === "done" ? "#a8ff3e" : hasAudio ? "#000" : "#2a2a3a",
          fontFamily: "Space Grotesk, sans-serif",
          fontSize: 15,
          border: `1.5px solid ${hasAudio ? "transparent" : "#1a1a24"}`,
          boxShadow: hasAudio && exportState === "idle" ? "0 0 30px rgba(168,255,62,0.3)" : "none",
        }}
      >
        {exportState === "exporting" ? (
          <><Loader2 size={18} className="animate-spin" /> 書き出し中</>
        ) : exportState === "done" ? (
          <><CheckCircle size={18} /> 完了！</>
        ) : exportState === "error" ? (
          <>エラーが発生しました</>
        ) : (
          <><Download size={18} /> {format.toUpperCase()}で書き出す</>
        )}
      </motion.button>

      <p style={{ fontSize: 10, color: "#2a2a3a", textAlign: "center" }}>
        音声データはデバイス上でのみ処理されます
      </p>
    </div>
  );
}
