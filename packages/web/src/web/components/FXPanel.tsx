import { useState } from "react";
import { motion } from "framer-motion";
import { audioEngine } from "../lib/audioEngine";

type FX = {
  id: string;
  name: string;
  category: "transition" | "dance" | "space";
  color: string;
  icon: string;
  description: string;
};

const FX_LIST: FX[] = [
  { id: "rise", name: "Rise", category: "transition", color: "#00f5ff", icon: "↑", description: "盛り上がり" },
  { id: "drop", name: "Drop", category: "transition", color: "#ff00aa", icon: "↓", description: "ドロップ" },
  { id: "reverse", name: "Reverse", category: "transition", color: "#a8ff3e", icon: "◁◁", description: "逆再生" },
  { id: "tapestop", name: "Tape Stop", category: "transition", color: "#ff6b2b", icon: "⬛", description: "急停止" },
  { id: "beatrepeat", name: "Beat Repeat", category: "dance", color: "#a8ff3e", icon: "⟳", description: "ビート繰り返し" },
  { id: "bassdrop", name: "Bass Drop", category: "dance", color: "#ff00aa", icon: "🔊", description: "重低音" },
  { id: "vocalchop", name: "Vocal Chop", category: "dance", color: "#00f5ff", icon: "✂", description: "ボイスカット" },
  { id: "echo", name: "Echo", category: "space", color: "#b266ff", icon: "〰", description: "エコー" },
  { id: "airspace", name: "Air Space", category: "space", color: "#ffffff", icon: "∿", description: "空間" },
];

const CATEGORY_LABELS = {
  transition: "トランジション",
  dance: "ダンス",
  space: "スペース",
};

export default function FXPanel() {
  const [active, setActive] = useState<string | null>(null);
  const [category, setCategory] = useState<FX["category"]>("transition");

  const filtered = FX_LIST.filter((f) => f.category === category);

  const handleApply = async (fx: FX) => {
    setActive(fx.id);
    if ("vibrate" in navigator) navigator.vibrate(30);
    setTimeout(() => setActive(null), 600);
    await audioEngine.ensureRunning();
    audioEngine.applyFX(fx.id);
  };

  return (
    <div className="space-y-4">
      {/* Category tabs */}
      <div
        className="flex rounded-xl overflow-hidden"
        style={{ background: "#0a0a0f", border: "1px solid #1a1a24" }}
      >
        {(Object.keys(CATEGORY_LABELS) as FX["category"][]).map((cat) => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className="flex-1 py-2.5 text-xs font-semibold transition-all"
            style={{
              background: category === cat ? "#ff00aa22" : "none",
              color: category === cat ? "#ff00aa" : "#4a4a5a",
              borderBottom: category === cat ? "2px solid #ff00aa" : "2px solid transparent",
              fontFamily: "Space Grotesk, sans-serif",
            }}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        ))}
      </div>

      {/* FX Grid */}
      <div className="grid grid-cols-3 gap-2">
        {filtered.map((fx) => (
          <motion.button
            key={fx.id}
            onClick={() => handleApply(fx)}
            whileTap={{ scale: 0.92 }}
            animate={
              active === fx.id
                ? { scale: [1, 1.1, 1], boxShadow: [`0 0 0px ${fx.color}`, `0 0 30px ${fx.color}`, `0 0 0px ${fx.color}`] }
                : {}
            }
            className="flex flex-col items-center justify-center gap-1 py-4 rounded-xl transition-all"
            style={{
              background: active === fx.id ? `${fx.color}22` : "#111118",
              border: `1px solid ${active === fx.id ? fx.color + "66" : "#252535"}`,
            }}
          >
            <span style={{ fontSize: 20, color: fx.color }}>{fx.icon}</span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: active === fx.id ? fx.color : "white",
                fontFamily: "Space Grotesk, sans-serif",
              }}
            >
              {fx.name}
            </span>
            <span style={{ fontSize: 9, color: "#4a4a5a" }}>{fx.description}</span>
          </motion.button>
        ))}
      </div>


    </div>
  );
}
