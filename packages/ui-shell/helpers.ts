export const errorMessage = (cause: unknown, fallback: string) => cause instanceof Error ? cause.message : fallback;
export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
