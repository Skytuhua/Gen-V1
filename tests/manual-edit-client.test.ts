import {describe,expect,it} from 'vitest';
import {editDisabledReason,editErrorCopy,editJournalKey,editLineSeparator,editReduce,editSaveText,splitBom} from '../apps/web/src/files/manual-edit-state.ts';
import {KEYBOARD_BINDINGS,bindingChords} from '../apps/web/src/keyboard-bindings.ts';

describe('manual edit state machine',()=>{
 it('walks viewing through clean/dirty/save and back',()=>{
  expect(editReduce('loading',{type:'ready'})).toBe('clean');
  expect(editReduce('clean',{type:'change',dirty:true})).toBe('dirty');
  expect(editReduce('dirty',{type:'change',dirty:false})).toBe('clean'); // undo to loaded
  expect(editReduce('dirty',{type:'save'})).toBe('saving');
  expect(editReduce('saving',{type:'saved'})).toBe('clean');
 });
 it('keeps the draft on a generic save failure and conflicts on precondition',()=>{
  expect(editReduce('saving',{type:'saveFailed'})).toBe('dirty');
  expect(editReduce('saving',{type:'saveConflict'})).toBe('conflict');
 });
 it('detects disk changes: silent reload when clean, conflict when dirty',()=>{
  expect(editReduce('clean',{type:'diskChanged'})).toBe('clean');
  expect(editReduce('dirty',{type:'diskChanged'})).toBe('conflict');
 });
 it('conflict resolves via compare, reload or overwrite; disk loss is unavailable',()=>{
  expect(editReduce('conflict',{type:'compare'})).toBe('comparing');
  expect(editReduce('comparing',{type:'closeCompare'})).toBe('conflict');
  expect(editReduce('conflict',{type:'reload'})).toBe('loading');
  expect(editReduce('comparing',{type:'overwrite'})).toBe('saving');
  expect(editReduce('conflict',{type:'overwrite'})).toBe('saving');
  expect(editReduce('dirty',{type:'diskGone'})).toBe('unavailable');
  expect(editReduce('conflict',{type:'diskGone'})).toBe('unavailable');
 });
 it('boot paths: draft restore is dirty, a stale draft is conflict',()=>{
  expect(editReduce('loading',{type:'draftRestored'})).toBe('dirty');
  expect(editReduce('loading',{type:'draftConflict'})).toBe('conflict');
 });
});

describe('manual edit text model',()=>{
 it('save text restores the BOM and keeps the document verbatim',()=>{
  expect(editSaveText(false,'a\nb\n')).toBe('a\nb\n');
  expect(editSaveText(true,'a\nb\n')).toBe('﻿a\nb\n');
 });
 it('splits the BOM for display',()=>{
  expect(splitBom('﻿a')).toEqual({bom:true,text:'a'});
  expect(splitBom('a')).toEqual({bom:false,text:'a'});
 });
 it('maps separators: CRLF keeps CRLF, mixed normalizes to LF',()=>{
  expect(editLineSeparator('crlf')).toBe('\r\n');
  expect(editLineSeparator('lf')).toBe('\n');
  expect(editLineSeparator('mixed')).toBe('\n');
 });
});

describe('manual edit journal key and copy',()=>{
 it('keys drafts by project, thread and path',()=>{
  expect(editJournalKey('p','t','a/b.txt')).toBe('files.edit:p:t:a/b.txt');
  expect(editJournalKey('p',null,'a')).toBe('files.edit:p:-:a');
 });
 it('maps disabled reasons and error copy',()=>{
  expect(editDisabledReason('binary')).toContain('Binary');
  expect(editDisabledReason('protected')).toContain('protected');
  expect(editErrorCopy('CAPABILITY_DENIED').retry).toBe(false);
  expect(editErrorCopy('RESOURCE_LIMIT').text).toContain('1 MB');
  expect(editErrorCopy('HTTP_500').retry).toBe(true);
 });
});

describe('manual edit keyboard registry',()=>{
 it('registers files.edit, files.save and files.doneEditing',()=>{
  const ids=new Set(KEYBOARD_BINDINGS.map(binding=>binding.id));
  expect(ids.has('files.edit')).toBe(true);
  expect(ids.has('files.save')).toBe(true);
  expect(ids.has('files.doneEditing')).toBe(true);
  const chords=(id:string)=>bindingChords(KEYBOARD_BINDINGS.find(binding=>binding.id===id)!);
  expect(chords('files.edit')).toEqual(['E']);
  expect(chords('files.save')).toEqual(['Ctrl+S']);
  expect(chords('files.doneEditing')).toEqual(['Escape']);
 });
});
