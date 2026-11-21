import {describe,expect,it} from 'vitest';
import {API_ERROR_CODES} from '../packages/contracts/errors.ts';
import {recoveryMessage,errorText} from '../apps/web/src/error-recovery.ts';

describe('recoveryMessage',()=>{
  it('returns non-empty recovery copy for every census code',()=>{
    for(const code of API_ERROR_CODES)expect(recoveryMessage(code).length).toBeGreaterThan(0);
  });
  it('maps auth and refresh families to their action copy',()=>{
    expect(recoveryMessage('AUTH_REQUIRED')).toContain('Reconnect');
    expect(recoveryMessage('AI_AUTH_REQUIRED')).toContain('Reconnect');
    expect(recoveryMessage('CSRF_REQUIRED')).toContain('Refresh');
    expect(recoveryMessage('NOT_FOUND')).toContain('no longer exists');
  });
  it('maps change, limit and action families',()=>{
    expect(recoveryMessage('REVISION_CHANGED')).toContain('refresh and retry');
    expect(recoveryMessage('RATE_LIMITED')).toContain('Wait a minute');
    expect(recoveryMessage('RESOURCE_LIMIT')).toContain('too large');
    expect(recoveryMessage('ACTION_UNCERTAIN')).toContain('may already have run');
    expect(recoveryMessage('APPROVAL_REQUIRED')).toContain('Approve');
  });
  it('maps *_UNAVAILABLE, CANCELLED*, provider and default families',()=>{
    expect(recoveryMessage('PLUGIN_UNAVAILABLE')).toContain('temporarily unavailable');
    expect(recoveryMessage('CANCELLED_RUN')).toContain('cancelled');
    expect(recoveryMessage('GITHUB_AUTH_EXPIRED')).toContain('GitHub');
    expect(recoveryMessage('PI_CREDENTIAL_LEASE_LOST')).toContain('Sign in');
    expect(recoveryMessage('HOST_ERROR')).toContain('Something went wrong');
  });
  it('treats client-only and malformed codes safely',()=>{
    expect(recoveryMessage('HTTP_ERROR')).toBe('Something went wrong on the local host. Try again.');
    expect(recoveryMessage('RESPONSE_TOO_LARGE')).toContain('too large');
    expect(recoveryMessage('not-a-code')).toBe('Something went wrong on the local host. Try again.');
  });
});

describe('errorText',()=>{
  it('appends recovery copy for coded errors',()=>{
    expect(errorText(Object.assign(new Error('Nope.'),{code:'NOT_FOUND'}),'x')).toBe('Nope. This item no longer exists. Refresh the view.');
  });
  it('keeps the raw message for uncoded errors and the fallback otherwise',()=>{
    expect(errorText(new Error('plain'),'x')).toBe('plain');
    expect(errorText('nope','fallback')).toBe('fallback');
  });
});
