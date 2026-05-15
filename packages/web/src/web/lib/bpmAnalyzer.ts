/**
 * BPM Analyzer using Web Audio API + autocorrelation
 * Lightweight DSP — no heavy ML libraries
 */

export type BPMResult = {
  bpm: number;
  confidence: number;
  beatPositions: number[]; // seconds
  downbeatPositions: number[]; // every 4 beats
};

/**
 * Compute onset detection function from audio buffer
 */
function computeOnsetStrength(
  channelData: Float32Array,
  sampleRate: number,
  hopSize = 512,
  fftSize = 2048
): Float32Array {
  const numFrames = Math.floor((channelData.length - fftSize) / hopSize);
  const onsets = new Float32Array(numFrames);

  let prevEnergy = 0;
  for (let i = 0; i < numFrames; i++) {
    const start = i * hopSize;
    let energy = 0;
    for (let j = start; j < start + fftSize && j < channelData.length; j++) {
      energy += channelData[j] * channelData[j];
    }
    const rms = Math.sqrt(energy / fftSize);
    onsets[i] = Math.max(0, rms - prevEnergy);
    prevEnergy = rms;
  }
  return onsets;
}

/**
 * Autocorrelation BPM detection
 */
function detectBPMFromOnsets(
  onsets: Float32Array,
  sampleRate: number,
  hopSize: number
): { bpm: number; confidence: number } {
  const secPerFrame = hopSize / sampleRate;
  const minBPM = 60;
  const maxBPM = 200;
  const minLag = Math.round(60 / (maxBPM * secPerFrame));
  const maxLag = Math.round(60 / (minBPM * secPerFrame));

  let bestBpm = 120;
  let bestScore = 0;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let score = 0;
    let count = 0;
    for (let i = 0; i < onsets.length - lag; i++) {
      score += onsets[i] * onsets[i + lag];
      count++;
    }
    if (count > 0) score /= count;

    const bpm = 60 / (lag * secPerFrame);
    if (score > bestScore) {
      bestScore = score;
      bestBpm = bpm;
    }
  }

  // Normalize confidence
  const confidence = Math.min(1, bestScore * 50);
  return { bpm: Math.round(bestBpm * 10) / 10, confidence };
}

/**
 * Pick beat positions using the detected BPM
 */
function pickBeatPositions(
  onsets: Float32Array,
  bpm: number,
  sampleRate: number,
  hopSize: number,
  duration: number
): number[] {
  const beatInterval = 60 / bpm; // seconds per beat
  const positions: number[] = [];

  // Find best phase offset
  let bestPhase = 0;
  let bestScore = -1;
  const framesPerBeat = beatInterval / (hopSize / sampleRate);

  for (let phaseOffset = 0; phaseOffset < framesPerBeat; phaseOffset += 1) {
    let score = 0;
    let frame = phaseOffset;
    while (frame < onsets.length) {
      score += onsets[Math.round(frame)] || 0;
      frame += framesPerBeat;
    }
    if (score > bestScore) {
      bestScore = score;
      bestPhase = phaseOffset;
    }
  }

  // Generate beat times from best phase
  const secPerFrame = hopSize / sampleRate;
  let t = bestPhase * secPerFrame;
  while (t < duration) {
    positions.push(Math.round(t * 1000) / 1000);
    t += beatInterval;
  }

  return positions;
}

/**
 * Main analysis function — runs in Web Worker or main thread
 */
export async function analyzeBPM(audioBuffer: AudioBuffer): Promise<BPMResult> {
  const sampleRate = audioBuffer.sampleRate;
  const duration = audioBuffer.duration;

  // Mix down to mono
  const numChannels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const mono = new Float32Array(length);

  for (let c = 0; c < numChannels; c++) {
    const channel = audioBuffer.getChannelData(c);
    for (let i = 0; i < length; i++) {
      mono[i] += channel[i] / numChannels;
    }
  }

  // Use middle 60s for faster analysis
  const analyzeStart = Math.floor(Math.min(10, duration * 0.1) * sampleRate);
  const analyzeLength = Math.floor(Math.min(60, duration * 0.6) * sampleRate);
  const segment = mono.slice(analyzeStart, analyzeStart + analyzeLength);

  const hopSize = 512;
  const fftSize = 2048;
  const onsets = computeOnsetStrength(segment, sampleRate, hopSize, fftSize);
  const { bpm, confidence } = detectBPMFromOnsets(onsets, sampleRate, hopSize);

  // Clamp to musical range
  let finalBpm = bpm;
  while (finalBpm < 60) finalBpm *= 2;
  while (finalBpm > 200) finalBpm /= 2;
  finalBpm = Math.round(finalBpm * 10) / 10;

  const beatPositions = pickBeatPositions(onsets, finalBpm, sampleRate, hopSize, duration);
  const downbeatPositions = beatPositions.filter((_, i) => i % 4 === 0);

  return {
    bpm: finalBpm,
    confidence,
    beatPositions,
    downbeatPositions,
  };
}

/**
 * Decode audio file to AudioBuffer
 */
export async function decodeAudioFile(
  file: File,
  ctx: AudioContext
): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer();
  // iOS SafariはPromise形式のdecodeAudioDataをサポートしない場合があるのでコールバック形式を使う
  return new Promise((resolve, reject) => {
    ctx.decodeAudioData(arrayBuffer, resolve, reject);
  });
}

/**
 * Extract waveform data for display
 * 高解像度: サンプル数を多く取り、高ズームでもなめらかに
 */
export function extractWaveform(
  audioBuffer: AudioBuffer,
  numSamples = 4000
): Float32Array {
  const channelData = audioBuffer.getChannelData(0);
  const ch2 = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : null;
  // 最低でもサンプルレート/10のサンプル数を確保（1秒あたり ~4410点）
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
