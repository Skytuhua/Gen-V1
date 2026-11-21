export const PERSONAL_INSTRUCTIONS_MAX_BYTES = 16 * 1024;
export type PersonalInstructionsStatus = 'OK' | 'ABSENT' | 'EXCLUDED';
export type PersonalInstructionsExclusion = 'SOURCE_TOO_LARGE' | 'SOURCE_NOT_TEXT' | 'UNSUPPORTED_DIRECTIVE' | 'UNAVAILABLE_SOURCE';
export interface PersonalInstructionsView {
  text: string;
  digest: string | null;
  bytes: number;
  updatedAt: string | null;
  status: PersonalInstructionsStatus;
  reason?: PersonalInstructionsExclusion;
  path?: string; // display only, desktop
}
export interface PersonalInstructionsUpdate { text: string; baseDigest: string | null; }
