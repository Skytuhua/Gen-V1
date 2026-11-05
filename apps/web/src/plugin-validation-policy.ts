import {z} from 'zod';

// Shared renderers also run inside opaque frames without unsafe-eval.
// Use interpreted validation before their schemas are initialized.
z.config({jitless:true});
