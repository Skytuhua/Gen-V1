/** Exact proposed protected-file seam, tested without writing App.tsx. Parent owns adoption. */
export function agentsAppCandidate(source: string): string {
 const integrated = 'export function App(props:AppProps={})';
 if (source.includes(integrated)) return "import {AgentsWorkspace,type AgentsWorkspaceProps} from './agents-workspace';\n" + source.replace(integrated, 'function IntegratedApp(props:AppProps={})') + '\nexport function App({agentsWorkspace,...props}:AppProps&{agentsWorkspace?:AgentsWorkspaceProps}={}) {return agentsWorkspace?<AgentsWorkspace {...agentsWorkspace}/>:<IntegratedApp {...props}/>;}\n';
 const signature = 'export function App({embeddedThreadId,embeddedActive=true,onRequestThread}';
 if (!source.includes(signature)) throw Error('App integration target changed. Rebase the candidate patch.');
 return "import {AgentsWorkspace,type AgentsWorkspaceProps} from './agents-workspace';\n" + source.replace(signature,
  "export function App({agentsWorkspace,...props}:NonNullable<Parameters<typeof ConversationApp>[0]>&{agentsWorkspace?:AgentsWorkspaceProps}={}) {\n return agentsWorkspace?<AgentsWorkspace {...agentsWorkspace}/>:<ConversationApp {...props}/>;\n}\nfunction ConversationApp({embeddedThreadId,embeddedActive=true,onRequestThread}");
}
