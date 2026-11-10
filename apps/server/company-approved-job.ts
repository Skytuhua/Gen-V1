import {closeSync, fstatSync, openSync, readSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {captureApprovedJobRead} from '../../packages/company-contracts/approved-job-read.ts';
import {decodeWorkPlanJson} from '../../packages/company-contracts/work-plan.ts';

/** Bounded public reference configuration. It supplies no approval or permission. */
export function readApprovedJobFile(path: string) {
  if (!isAbsolute(path)) throw new Error('Approved job read configuration requires an absolute path.');
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, 'r'); const info = fstatSync(descriptor);
    if (!info.isFile() || info.size < 1 || info.size > 32768) throw 0;
    const bytes = Buffer.alloc(32769), length = readSync(descriptor, bytes, 0, bytes.length, 0);
    if (length !== info.size) throw 0;
    return captureApprovedJobRead(decodeWorkPlanJson(bytes.subarray(0, length), 32768));
  } catch {throw new Error('Approved job read configuration is unavailable or invalid.');}
  finally {if (descriptor !== undefined) closeSync(descriptor);}
}
