import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { audioEngine } from "../lib/audioEngine";

type SFX = {
  id: string;
  name: string;
  icon: string;
  color: string;
  freq: number; // synthetic sound freq
  type: "boom" | "crowd" | "impact" | "scratch" | "air" | "vocal";
};

const SFX_LIST: SFX[] = [
  { id: "boom", name: "Boom", icon: "BOOM", color: "#ff6b2b", freq: 60, type: "boom" },
  { id: "crowd", name: "Crowd", icon: "CROWD", color: "#a8ff3e", freq: 300, type: "crowd" },
  { id: "impact", name: "Impact", icon: "HIT", color: "#00f5ff", freq: 150, type: "impact" },
  { id: "scratch", name: "Scratch", icon: "SCRATCH", color: "#ff00aa", freq: 800, type: "scratch" },
  { id: "air", name: "Air Horn", icon: "HORN", color: "#ffdd00", freq: 440, type: "air" },
  { id: "vocal", name: "Vocal FX", icon: "VOCAL", color: "#b266ff", freq: 220, type: "vocal" },
];

function playSynthSFX(sfx: SFX) {
  const ctx = audioEngine.getContext();
  const now = ctx.currentTime;

  if (sfx.type === "boom") {
    // Kick-like boom
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(0.01, now + 0.5);
    gain.gain.setValueAtTime(1, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.5);
  } else if (sfx.type === "crowd") {
    // White noise burst
    const bufSize = ctx.sampleRate * 0.8;
    const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * 0.3;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.8, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
    src.connect(gain);
    gain.connect(ctx.destination);
    src.start(now);
  } else if (sfx.type === "impact") {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(200, now);
    osc.frequency.exponentialRampToValueAtTime(10, now + 0.3);
    gain.gain.setValueAtTime(0.8, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.3);
  } else if (sfx.type === "scratch") {
    // Modulated noise
    const osc = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modGain = ctx.createGain();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 800;
    mod.frequency.value = 20;
    mod.type = "sine";
    modGain.gain.value = 400;
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    mod.connect(modGain);
    modGain.connect(osc.frequency);
    osc.connect(gain);
    gain.connect(ctx.destination);
    mod.start(now); osc.start(now);
    mod.stop(now + 0.4); osc.stop(now + 0.4);
  } else if (sfx.type === "air") {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 440;
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.setValueAtTime(0, now + 0.8);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.8);
  } else {
    // Vocal — sine glide
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.exponentialRampToValueAtTime(600, now + 0.3);
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.5);
  }
}

export default function SFXPanel() {
  const [pressed, setPressed] = useState<string | null>(null);

  const handleSFX = async (sfx: SFX) => {
    await audioEngine.ensureRunning();
    playSynthSFX(sfx);
    setPressed(sfx.id);
    if ("vibrate" in navigator) navigator.vibrate(20);
    setTimeout(() => setPressed(null), 300);
  };

  return (
    <div className="space-y-4">
      <p style={{ fontSize: 12, color: "#4a4a5a", textAlign: "center" }}>
        ワンタップで効果音を追加
      </p>

      <div className="grid grid-cols-3 gap-3">
        {SFX_LIST.map((sfx) => (
          <motion.button
            key={sfx.id}
            onMouseDown={() => handleSFX(sfx)}
            onTouchStart={(e) => { e.preventDefault(); handleSFX(sfx); }}
            whileTap={{ scale: 0.88 }}
            animate={
              pressed === sfx.id
                ? {
                    scale: [1, 1.15, 1],
                    boxShadow: [
                      `0 0 0px ${sfx.color}`,
                      `0 0 40px ${sfx.color}88`,
                      `0 0 0px ${sfx.color}`,
                    ],
                  }
                : {}
            }
            className="flex flex-col items-center gap-2 py-5 rounded-2xl"
            style={{
              background: pressed === sfx.id ? `${sfx.color}22` : "#111118",
              border: `1.5px solid ${pressed === sfx.id ? sfx.color : "#252535"}`,
              cursor: "pointer",
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: -0.5, fontFamily: "Space Grotesk, sans-serif", color: sfx.color }}>{sfx.icon}</span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: sfx.color,
                fontFamily: "Space Grotesk, sans-serif",
                textShadow: pressed === sfx.id ? `0 0 12px ${sfx.color}` : "none",
              }}
            >
              {sfx.name}
            </span>
          </motion.button>
        ))}
      </div>

      <div
        className="rounded-xl p-3"
        style={{ background: "#0a0a0f", border: "1px solid #1a1a24" }}
      >
        <p style={{ fontSize: 11, color: "#4a4a5a", textAlign: "center" }}>
          カスタム効果音のアップロードは近日対応予定
        </p>
      </div>
    </div>
  );
}
