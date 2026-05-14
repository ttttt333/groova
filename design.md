# GROOVA Design System

## Concept
"Neon on Obsidian" — ダンサーが踊りたくなるダーク×ネオンUI

## Colors
```css
--bg-obsidian: #0a0a0f        /* 最深黒 */
--bg-surface: #111118         /* カード背景 */
--bg-elevated: #1a1a24        /* 浮き上がり */
--bg-border: #2a2a3a          /* ボーダー */

--green-acid: #a8ff3e         /* Acid Green: BPM/Grid */
--green-dim: #4a7a1a          /* グリーン暗め */
--cyan-electric: #00f5ff      /* Electric Cyan: AI/Scan */
--magenta-fx: #ff00aa         /* Vibrant Magenta: FX */
--orange-accent: #ff6b2b      /* オレンジアクセント (ref画像より) */
--white-pure: #ffffff
--gray-400: #9999aa
--gray-600: #4a4a5a
```

## Typography
- Display: "Space Grotesk" — 太め、インパクト
- Body: "Inter" — 読みやすい
- Mono: "JetBrains Mono" — BPM数値等

## Spacing & Layout
- Mobile-first: max-width 430px centered
- Bottom nav: 64px fixed
- Touch targets: minimum 44px
- Border radius: 12px (cards), 8px (buttons), 999px (pills)

## Motion
- Beat Glow: 背景がBPMに合わせてパルス
- Scan Line: Cyan光が波形を走る
- Elastic Snap: グリッド吸着時の反発アニメ
- Transition: 200ms ease-out standard

## Component Style
- Cards: dark surface + thin neon border glow
- Buttons: pill shape, neon fill or ghost
- Sliders: custom neon track
- Waveform: dark canvas, green beats, cyan scan

## Reference
- UI inspiration: portfolio image (dark bg, orange accent, clean typography)
- Design spec: GROOVA v6.0 設計書
