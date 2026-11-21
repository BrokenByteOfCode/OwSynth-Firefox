declare var sampleRate: number;

export const DEFAULT_SAMPLE_RATE = 44100;

export const getSampleRate = (): number => {
  if (typeof sampleRate === 'number' && sampleRate > 0) {
    return sampleRate;
  }
  return DEFAULT_SAMPLE_RATE;
};