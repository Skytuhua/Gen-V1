import {describe,it,expect} from 'vitest';
import {parseOpenProjectArgs} from '../apps/desktop/open-project-args.ts';

const open=(path:string)=>({kind:'open',path});

describe('parseOpenProjectArgs',()=>{
 it('returns none without the switch, ignoring unrelated arguments',()=>{
  expect(parseOpenProjectArgs([])).toEqual({kind:'none'});
  expect(parseOpenProjectArgs(['Gen V1.exe','--verbose','C:\\Projects'])).toEqual({kind:'none'});
 });
 it('accepts drive-letter absolute paths with either separator',()=>{
  expect(parseOpenProjectArgs(['--open-project','C:\\Projects\\App'])).toEqual(open('C:\\Projects\\App'));
  expect(parseOpenProjectArgs(['--open-project','D:/code/gen'])).toEqual(open('D:/code/gen'));
  expect(parseOpenProjectArgs(['--open-project','c:\\lowercase'])).toEqual(open('c:\\lowercase'));
  expect(parseOpenProjectArgs(['--open-project','C:\\'])).toEqual(open('C:\\'));
 });
 it('accepts UNC absolute paths',()=>{
  expect(parseOpenProjectArgs(['--open-project','\\\\server\\share\\dir'])).toEqual(open('\\\\server\\share\\dir'));
  expect(parseOpenProjectArgs(['--open-project','\\\\server\\share'])).toEqual(open('\\\\server\\share'));
 });
 it('accepts spaces, Unicode and trailing separators without rewriting the value',()=>{
  expect(parseOpenProjectArgs(['--open-project','C:\\My Project\\ßü\\'])).toEqual(open('C:\\My Project\\ßü\\'));
 });
 it('ignores unrelated arguments around the switch',()=>{
  expect(parseOpenProjectArgs(['--inspect','9229','--open-project','C:\\x','--trace'])).toEqual(open('C:\\x'));
 });
 it('rejects a missing, empty or switch-shaped operand',()=>{
  expect(parseOpenProjectArgs(['--open-project']).kind).toBe('invalid');
  expect(parseOpenProjectArgs(['--open-project','']).kind).toBe('invalid');
  expect(parseOpenProjectArgs(['--open-project','--verbose']).kind).toBe('invalid');
 });
 it('rejects repeated switches instead of choosing one',()=>{
  expect(parseOpenProjectArgs(['--open-project','C:\\a','--open-project','C:\\b']).kind).toBe('invalid');
  expect(parseOpenProjectArgs(['--open-project','--open-project','C:\\a']).kind).toBe('invalid');
 });
 it('rejects the inline = form so a malformed verb fails visibly',()=>{
  expect(parseOpenProjectArgs(['--open-project=C:\\a']).kind).toBe('invalid');
 });
 it('rejects relative, root-relative and drive-relative paths',()=>{
  for(const path of ['Projects\\App','.\\App','..\\App','\\Projects\\App','C:Projects\\App','C:'])expect(parseOpenProjectArgs(['--open-project',path]).kind).toBe('invalid');
 });
 it('rejects URLs and scheme-like inputs',()=>{
  for(const path of ['http://host/x','https://host/x','file:///C:/x','genv1://open'])expect(parseOpenProjectArgs(['--open-project',path]).kind).toBe('invalid');
 });
 it('rejects device-namespace prefixes',()=>{
  for(const path of ['\\\\?\\C:\\x','\\\\.\\pipe\\x','\\\\?\\UNC\\srv\\share'])expect(parseOpenProjectArgs(['--open-project',path]).kind).toBe('invalid');
 });
 it('rejects a UNC string without a share',()=>{
  expect(parseOpenProjectArgs(['--open-project','\\\\server']).kind).toBe('invalid');
 });
 it('rejects a second colon outside the drive suffix',()=>{
  expect(parseOpenProjectArgs(['--open-project','C:\\a:b']).kind).toBe('invalid');
  expect(parseOpenProjectArgs(['--open-project','\\\\srv\\sh:are']).kind).toBe('invalid');
 });
 it('rejects Windows-forbidden name characters including quotes',()=>{
  for(const path of ['C:\\a"b','C:\\a|b','C:\\a*b','C:\\a<b','C:\\a?b'])expect(parseOpenProjectArgs(['--open-project',path]).kind).toBe('invalid');
  expect(parseOpenProjectArgs(['--open-project','C:\\a\tb']).kind).toBe('invalid');
 });
 it('rejects overlong values at the connect bound',()=>{
  expect(parseOpenProjectArgs(['--open-project','C:\\'+'x'.repeat(4096)]).kind).toBe('invalid');
  expect(parseOpenProjectArgs(['--open-project','C:\\'+'x'.repeat(4092)]).kind).toBe('open');
 });
 it('never executes or expands the value and leaves it byte-identical',()=>{
  const path='C:\\%APPDATA%\\$env\\~name';
  expect(parseOpenProjectArgs(['--open-project',path])).toEqual(open(path));
 });
});
