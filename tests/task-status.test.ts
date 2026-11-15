import {describe,expect,it} from 'vitest';
import {operationStatusKind} from '../apps/web/src/task-status';

describe('operation status semantic kind (AUD-14 / T14)',()=>{
 it('treats a cancelled operation as neutral, not an error',()=>{
  expect(operationStatusKind.cancelled).toBe('neutral');
 });
 it('keeps actual failures red and success green',()=>{
  expect(operationStatusKind.failed).toBe('error');
  expect(operationStatusKind.succeeded).toBe('success');
 });
 it('maps running to running and prepared/unknown to pending',()=>{
  expect(operationStatusKind.running).toBe('running');
  expect(operationStatusKind.prepared).toBe('pending');
  expect(operationStatusKind.unknown).toBe('pending');
 });
});
