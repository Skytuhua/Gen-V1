import {toApiErrorCode} from '../../../packages/contracts/errors.ts';

// One sentence of recovery copy per API error code, shown beside the raw
// server message so every error surface reads the same. Accepts the wire
// code as a string (client-only codes like HTTP_ERROR fall through to the
// default) and never exposes stack text — per #1063 T03.
export function recoveryMessage(code:string):string {
  switch(toApiErrorCode(code)){
    case 'AUTH_REQUIRED':case 'AI_AUTH_REQUIRED':case 'LAUNCH_TOKEN_REQUIRED':
      return 'Reconnect to the local host and try again.';
    case 'CSRF_REQUIRED':
      return 'Refresh the app, then retry the action.';
    case 'NOT_FOUND':
      return 'This item no longer exists. Refresh the view.';
    case 'REVISION_CHANGED':case 'WORKSPACE_CHANGED':case 'SOURCE_CHANGED':
      return 'This changed since you opened it — refresh and retry.';
    case 'RATE_LIMITED':case 'STREAM_LIMIT':case 'PAIRING_RATE_LIMITED':
      return 'Too many attempts. Wait a minute and try again.';
    case 'RESOURCE_LIMIT':case 'RESPONSE_TOO_LARGE':
      return 'This request is too large. Reduce its size and retry.';
    case 'APPROVAL_REQUIRED':
      return 'Approve the pending request, then retry.';
    case 'TERMINAL_ENDED':
      return 'This terminal has exited.';
    case 'PRECONDITION_FAILED':
      return 'A precondition failed. Refresh and check the prerequisites.';
    case 'ACTION_UNCERTAIN':
      return 'The action may already have run — refresh status before retrying.';
    default:break;
  }
  if(code.endsWith('_UNAVAILABLE'))return 'This capability is temporarily unavailable. Try again shortly.';
  if(code.startsWith('CANCELLED'))return 'The operation was cancelled.';
  if(code.startsWith('GITHUB_AUTH_'))return 'Reconnect your GitHub account, then retry.';
  if(code.startsWith('PI_CREDENTIAL_LEASE_'))return 'Sign in to the provider again to renew the credential.';
  return 'Something went wrong on the local host. Try again.';
}

// Raw message plus its recovery sentence for any thrown value; the surface
// fallback is kept for non-API failures.
export function errorText(cause:unknown,fallback:string):string {
  if(cause instanceof Error){
    const code=(cause as {code?:unknown}).code;
    return typeof code==='string'?cause.message+' '+recoveryMessage(code):cause.message;
  }
  return fallback;
}
