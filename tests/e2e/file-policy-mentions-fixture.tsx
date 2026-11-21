import {useMemo,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {agentFilePolicyDenier,admitAgentFileCandidate,filterAgentFileCandidates,agentFilePolicyDefaults} from '../../apps/web/src/agent-file-policy';
import {parseAgentFilePolicyRules} from '../../packages/contracts/agent-file-policy';
import '../../apps/web/src/styles.css';

const params=new URLSearchParams(location.search);
const CANDIDATES=(params.get('candidates')??'src/app.ts,.env,secrets/token.txt,docs/notes.md,certs/site.pem').split(',');
const parseRules=(value:string|null)=>value===null?null:parseAgentFilePolicyRules(value).rules;
const initial=()=>{
	const global=parseRules(params.get('global'));
	const project=parseRules(params.get('project'));
	const base=agentFilePolicyDefaults();
	return {global:global??base.global,project:project??base.project,revision:base.revision};
};

function Fixture(){
	const [policy,setPolicy]=useState(initial);
	const [staged,setStaged]=useState<string[]>([]);
	const [draft,setDraft]=useState('check the config');
	const [blocked,setBlocked]=useState<string[]>([]);
	const deny=useMemo(()=>agentFilePolicyDenier(policy),[policy]);
	const suggestions=filterAgentFileCandidates(CANDIDATES,deny,path=>path);
	const send=()=>{
		const blockedNow=[...new Set(staged.filter(path=>!admitAgentFileCandidate(path,deny)))];
		setBlocked(blockedNow);
		setStaged(value=>value.filter(path=>admitAgentFileCandidate(path,deny)));
	};
	return <div>
		<h1>File mention policy fixture</h1>
		<label>Rules <textarea data-testid="rules" defaultValue={params.get('project')??''} onChange={event=>{
			const {rules,errors}=parseAgentFilePolicyRules(event.target.value);
			if(!errors.length)setPolicy(value=>({...value,project:rules,revision:value.revision+'*'}));
		}}/></label>
		<ul data-testid="suggestions">
			{suggestions.map(path=><li key={path}><button data-suggestion={path} onClick={()=>setStaged(value=>value.includes(path)?value:[...value,path])}>{path}</button></li>)}
		</ul>
		<div data-testid="staged">
			{staged.map(path=><span key={path} data-chip={path}>{path}</span>)}
		</div>
		<div data-testid="blocked">
			{blocked.map(path=><span key={path} data-blocked-chip={path}>blocked</span>)}
		</div>
		<textarea data-testid="draft" value={draft} onChange={event=>setDraft(event.target.value)}/>
		<button data-testid="send" onClick={send}>Send</button>
	</div>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
