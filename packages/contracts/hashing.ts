import { z } from 'zod';

export const Sha256Hex = z.string().regex(/^[a-f0-9]{64}$/);
