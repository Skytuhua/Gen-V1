import {z} from 'zod';

// Company pages run under script-src 'self'. Zod's interpreted validators retain
// schema behavior without the optional, caught eval-capability probe.
z.config({jitless: true});
