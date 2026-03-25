import type { CompletionFinalResult } from './types';

export function calculateTextGenerationProgress(text: string): number {
  return Math.min((text.length / 1000) * 100, 90);
}

export function createCompletionFallbackResult(): CompletionFinalResult {
  return { usage: undefined, metadata: {} };
}

export function countGeneratedWords(text: string): number {
  return text.split(/\s+/).filter(word => word.length > 0).length;
}
