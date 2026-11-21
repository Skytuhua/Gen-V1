import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {BusyButton,ErrorState,Spinner} from '../packages/ui-shell/Feedback';

describe('Spinner',()=>{
 it('renders the ui-spinner glyph hidden from assistive tech',()=>{
  const html=renderToStaticMarkup(createElement(Spinner,{}));
  expect(html).toContain('ui-spinner');
  expect(html).toContain('aria-hidden="true"');
 });
});

describe('ErrorState',()=>{
 it('defaults to role=alert and keeps the full message without a retry handler',()=>{
  const html=renderToStaticMarkup(createElement(ErrorState,{message:'Sync failed. Try again.'}));
  expect(html).toContain('role="alert"');
  expect(html).toContain('Sync failed. Try again.');
  expect(html).not.toContain('ui-error-retry');
 });
 it('strips the trailing retry hint only when a retry button is offered',()=>{
  const html=renderToStaticMarkup(createElement(ErrorState,{message:'Sync failed. Please try again.',onRetry:()=>{}}));
  expect(html).toContain('>Sync failed.</p>');
  expect(html).not.toContain('Please try again.');
  expect(html).toContain('ui-error-retry');
  expect(html).toContain('>Retry<');
 });
 it('keeps the message when stripping it would leave nothing',()=>{
  const html=renderToStaticMarkup(createElement(ErrorState,{message:'Retry',onRetry:()=>{}}));
  expect(html).toContain('>Retry</p>');
 });
 it('honors live=status and a custom retry label',()=>{
  const html=renderToStaticMarkup(createElement(ErrorState,{message:'Paused',live:'status',onRetry:()=>{},retryLabel:'Resume'}));
  expect(html).toContain('role="status"');
  expect(html).toContain('>Resume<');
 });
 it('marks the retry button busy',()=>{
  const html=renderToStaticMarkup(createElement(ErrorState,{message:'x',onRetry:()=>{},busy:true}));
  expect(html).toContain('ui-error-retry');
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain('disabled');
 });
});

describe('BusyButton',()=>{
 it('defaults to type=button, enabled and not busy',()=>{
  const html=renderToStaticMarkup(createElement(BusyButton,{children:'Save'}));
  expect(html).toContain('type="button"');
  expect(html).toContain('>Save<');
  expect(html).not.toContain('aria-busy');
  expect(html).not.toContain('ui-spinner');
  expect(html).not.toContain('disabled');
 });
 it('disables itself, exposes aria-busy/data-busy and renders a spinner while busy',()=>{
  const html=renderToStaticMarkup(createElement(BusyButton,{busy:true,children:'Save'}));
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain('data-busy="true"');
  expect(html).toContain('disabled');
  expect(html).toContain('ui-spinner');
  expect(html).toContain('>Save<');
 });
 it('stays disabled without busy state when disabled is set',()=>{
  const html=renderToStaticMarkup(createElement(BusyButton,{disabled:true,children:'Save'}));
  expect(html).toContain('disabled');
  expect(html).not.toContain('aria-busy');
 });
});
