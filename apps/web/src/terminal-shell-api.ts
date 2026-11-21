import {authenticated,read,ApiError} from './api.ts';
import {terminalShellCatalogSchema,type TerminalShellCatalog} from '../../../packages/contracts/terminal-shell.ts';

/** Authenticated catalog read. refresh=1 asks the host to bypass its bounded
 * discovery cache; the HTTP cache header stays no-store either way. */
export function getTerminalShellCatalog(refresh=false,signal?:AbortSignal):Promise<TerminalShellCatalog>{
 return authenticated(()=>fetch(`/api/terminal-shells${refresh?'?refresh=1':''}`,{credentials:'same-origin',cache:'no-store',signal}))
 .then(async response=>{
  const body=await read<unknown>(response);
  const parsed=terminalShellCatalogSchema.safeParse(body);
  if(!parsed.success)throw new ApiError('INVALID_RESPONSE','The host returned an unexpected response.');
  return parsed.data;
 });
}
