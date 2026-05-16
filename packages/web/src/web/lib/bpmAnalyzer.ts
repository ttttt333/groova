/**
 * BPM Analyzer — improved multi-algorithm approach
 * 1. RMS-based onset strength
 * 2. Spectral flux onset (HF emphasis)
 * 3. Autocorrelation over both, pick highest-confidence winner
 * 4. Harmonic check: prefer integer multiples/halves that score better
 */

export type BPMResult = {
  bpm: number;
  confidence: number;
  beatPositions: number[];
  downbeatPositions: number[];
};

// --- Onset detection ---

function computeRMSOnset(
  mono: Float32Array,
  sampleRate: number,
  hopSize = 441
): Float32Array {
  const blockSize = 1024;
  const numFrames = Math.floor((mono.length - blockSize) / hopSize);
  const onsets = new Float32Array(numFrames);
  let prevRms = 0;
  for (let i = 0; i < numFrames; i++) {
    const s = i * hopSize;
    let energy = 0;
    for (let j = s; j < s + blockSize; j++) energy += mono[j] * mono[j];
    const rms = Math.sqrt(energy / blockSize);
    onsets[i] = Math.max(0, rms - prevRms);
    prevRms = rms;
  }
  return onsets;
}

function computeSpectralFluxOnset(
  mono: Float32Array,
  sampleRate: number,
  hopSize = 441,
  fftSize = 2048
): Float32Array {
  const numFrames = Math.floor((mono.length - fftSize) / hopSize);
  const onsets = new Float32Array(numFrames);

  // Simple high-frequency emphasis: look at the top 1/4 of the spectrum via naive DFT bands
  // Instead of full FFT (expensive), use a fast approximation: split into 8 sub-bands and track flux in upper bands
  const bands = 8;
  const bandSize = Math.floor(fftSize / bands);
  const prevPower = new Float32Array(bands);

  for (let i = 0; i < numFrames; i++) {
    const start = i * hopSize;
    let flux = 0;
    for (let b = 0; b < bands; b++) {
      const weight = 1 + b * 0.5; // emphasize high bands
      let power = 0;
      const bStart = start + b * bandSize;
      for (let j = bStart; j < bStart + bandSize && j < mono.length; j++) {
        power += mono[j] * mono[j];
      }
      power /= bandSize;
      const diff = power - prevPower[b];
      if (diff > 0) flux += diff * weight;
      prevPower[b] = power;
    }
    onsets[i] = flux;
  }
  return onsets;
}

// --- Autocorrelation BPM ---

function autocorrelBPM(
  onsets: Float32Array,
  sampleRate: number,
  hopSize: number,
  minBPM = 60,
  maxBPM = 200
): { bpm: number; confidence: number } {
  const secPerFrame = hopSize / sampleRate;
  const minLag = Math.max(1, Math.round(60 / (maxBPM * secPerFrame)));
  const maxLag = Math.round(60 / (minBPM * secPerFrame));

  // Mean-subtracted onsets for better correlation
  let mean = 0;
  for (let i = 0; i < onsets.length; i++) mean += onsets[i];
  mean /= onsets.length;
  const centered = new Float32Array(onsets.length);
  for (let i = 0; i < onsets.length; i++) centered[i] = onsets[i] - mean;

  let bestBpm = 120;
  let bestScore = -Infinity;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = 0;
    const n = onsets.length - lag;
    for (let i = 0; i < n; i++) score += centered[i] * centered[i + lag];
    score /= n;

    const bpm = 60 / (lag * secPerFrame);
    if (score > bestScore) {
      bestScore = score;
      bestBpm = bpm;
    }
  }

  // Also check half/double of best (sub-harmonic correction)
  const candidates = [bestBpm];
  if (bestBpm * 2 <= maxBPM) candidates.push(bestBpm * 2);
  if (bestBpm / 2 >= minBPM) candidates.push(bestBpm / 2);

  // Re-score each candidate with its nearest integer lag
  let finalBpm = bestBpm;
  let finalScore = bestScore;
  for (const cand of candidates) {
    const lag = Math.round(60 / (cand * secPerFrame));
    if (lag < minLag || lag > maxLag) continue;
    let score = 0;
    const n = onsets.length - lag;
    for (let i = 0; i < n; i++) score += centered[i] * centered[i + lag];
    score /= n;
    if (score > finalScore) {
      finalScore = score;
      finalBpm = cand;
    }
  }

  // Normalize confidence 0..1
  const maxPossible = (() => {
    let s = 0;
    for (let i = 0; i < centered.length; i++) s += centered[i] * centered[i];
    return s / centered.length;
  })();
  const confidence = maxPossible > 0 ? Math.min(1, finalScore / maxPossible) : 0;

  return { bpm: finalBpm, confidence: Math.max(0, confidence) };
}

// --- Harmonic correction ---
// After detecting BPM, try integer multiples/halves in musical range and
// pick the one most supported by the onset autocorrelation peak.
function harmonicCorrect(
  onsets: Float32Array,
  bpm: number,
  sampleRate: number,
  hopSize: number
): number {
  const secPerFrame = hopSize / sampleRate;
  const minBPM = 60;
  const maxBPM = 200;

  const candidates: number[] = [bpm];
  // halves and doubles
  let b = bpm;
  while (b / 2 >= minBPM) { b /= 2; candidates.push(b); }
  b = bpm;
  while (b * 2 <= maxBPM) { b *= 2; candidates.push(b); }
  // also 1.5x / 0.75x (triplet feel)
  if (bpm * 1.5 <= maxBPM) candidates.push(bpm * 1.5);
  if (bpm / 1.5 >= minBPM) candidates.push(bpm / 1.5);

  let bestBpm = bpm;
  let bestScore = -Infinity;

  // Mean-subtract
  let mean = 0;
  for (let i = 0; i < onsets.length; i++) mean += onsets[i];
  mean /= onsets.length;
  const centered = new Float32Array(onsets.length);
  for (let i = 0; i < onsets.length; i++) centered[i] = onsets[i] - mean;

  for (const cand of candidates) {
    const lag = Math.round(60 / (cand * secPerFrame));
    if (lag < 1 || lag >= onsets.length) continue;
    let score = 0;
    const n = centered.length - lag;
    for (let i = 0; i < n; i++) score += centered[i] * centered[i + lag];
    score /= n;
    // Small bias toward the original value to avoid unnecessary changes
    const bias = cand === bpm ? 0.05 : 0;
    if (score + bias > bestScore) {
      bestScore = score + bias;
      bestBpm = cand;
    }
  }

  return bestBpm;
}

// --- Beat position picking ---

function pickBeatPositions(
  onsets: Float32Array,
  bpm: number,
  sampleRate: number,
  hopSize: number,
  duration: number,
  skipSec: number = 0  // セグメント開始のオフセット（秒）
): number[] {
  const beatInterval = 60 / bpm;
  const secPerFrame = hopSize / sampleRate;
  const framesPerBeat = beatInterval / secPerFrame;

  // セグメント内でフェーズを最適化
  let bestPhase = 0;
  let bestScore = -1;
  const searchSteps = Math.ceil(framesPerBeat);

  for (let phaseOffset = 0; phaseOffset < searchSteps; phaseOffset++) {
    let score = 0;
    let frame = phaseOffset;
    while (frame < onsets.length) {
      score += onsets[Math.min(Math.round(frame), onsets.length - 1)];
      frame += framesPerBeat;
    }
    if (score > bestScore) {
      bestScore = score;
      bestPhase = phaseOffset;
    }
  }

  // セグメント内での最初のビート時刻（セグメント相対）
  const firstBeatInSegment = bestPhase * secPerFrame;

  // 音声全体の時刻に変換（skipSec + セグメント内時刻）
  const absoluteFirstBeat = skipSec + firstBeatInSegment;

  // 音声先頭に向かって逆方向に延伸し、t=0 以降の最初のビートを求める
  let t = absoluteFirstBeat;
  while (t >= beatInterval) t -= beatInterval;
  // t は now in [0, beatInterval)

  const positions: number[] = [];
  while (t < duration) {
    positions.push(Math.round(t * 1000) / 1000);
    t += beatInterval;
  }

  return positions;
}

// --- Main export ---

export async function analyzeBPM(audioBuffer: AudioBuffer): Promise<BPMResult> {
  const sampleRate = audioBuffer.sampleRate;
  const duration = audioBuffer.duration;

  // Mix to mono
  const numChannels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const mono = new Float32Array(length);
  for (let c = 0; c < numChannels; c++) {
    const ch = audioBuffer.getChannelData(c);
    for (let i = 0; i < length; i++) mono[i] += ch[i] / numChannels;
  }

  // Analyze multiple segments for robustness: intro skip + middle
  const segDuration = Math.min(90, duration * 0.7);
  const skip = Math.floor(Math.min(8, duration * 0.05) * sampleRate);
  const segLen = Math.floor(segDuration * sampleRate);
  const segment = mono.slice(skip, skip + segLen);

  const hopSize = 441; // ~10ms @ 44100Hz — finer resolution than 512

  const rmsOnsets = computeRMSOnset(segment, sampleRate, hopSize);
  const fluxOnsets = computeSpectralFluxOnset(segment, sampleRate, hopSize);

  const rmsResult = autocorrelBPM(rmsOnsets, sampleRate, hopSize);
  const fluxResult = autocorrelBPM(fluxOnsets, sampleRate, hopSize);

  // Pick the higher-confidence result
  let bestOnsets: Float32Array;
  let rawBpm: number;
  if (fluxResult.confidence >= rmsResult.confidence) {
    bestOnsets = fluxOnsets;
    rawBpm = fluxResult.bpm;
  } else {
    bestOnsets = rmsOnsets;
    rawBpm = rmsResult.bpm;
  }

  // Clamp to musical range first
  let bpm = rawBpm;
  while (bpm < 60) bpm *= 2;
  while (bpm > 200) bpm /= 2;

  // Harmonic correction
  bpm = harmonicCorrect(bestOnsets, bpm, sampleRate, hopSize);

  // Final musical range clamp
  while (bpm < 60) bpm *= 2;
  while (bpm > 200) bpm /= 2;

  bpm = Math.round(bpm * 10) / 10;

  const confidence = Math.max(rmsResult.confidence, fluxResult.confidence);
  const skipSec = skip / sampleRate;  // セグメントのオフセット（秒）を渡す
  const beatPositions = pickBeatPositions(bestOnsets, bpm, sampleRate, hopSize, duration, skipSec);
  const downbeatPositions = beatPositions.filter((_, i) => i % 4 === 0);

  return { bpm, confidence, beatPositions, downbeatPositions };
}

// --- File decode ---

export async function decodeAudioFile(
  file: File,
  ctx: AudioContext
): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    ctx.decodeAudioData(arrayBuffer, resolve, reject);
  });
}

// --- Waveform extraction ---

export function extractWaveform(
  audioBuffer: AudioBuffer,
  numSamples = 4000
): Float32Array {
  const channelData = audioBuffer.getChannelData(0);
  const ch2 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : null;
  const actual = Math.min(numSamples, channelData.length);
  const blockSize = Math.max(1, Math.floor(channelData.length / actual));
  const waveform = new Float32Array(actual);

  for (let i = 0; i < actual; i++) {
    let max = 0;
    const start = i * blockSize;
    const end = Math.min(start + blockSize, channelData.length);
    for (let j = start; j < end; j++) {
      const abs = ch2
        ? Math.max(Math.abs(channelData[j]), Math.abs(ch2[j]))
        : Math.abs(channelData[j]);
      if (abs > max) max = abs;
    }
    waveform[i] = max;
  }
  return waveform;
}
