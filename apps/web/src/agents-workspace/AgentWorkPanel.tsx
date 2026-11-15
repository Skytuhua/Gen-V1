import {useCallback, useEffect, useRef, useState} from 'react';
import {Ban, Eye, Play, Square} from 'lucide-react';
import {Select} from '../../../../packages/ui-shell/Select';
import {
  getAgentWork, getAgentWorkInputs, getAgentWorkMessages, getAgentWorkOutput, getAgentWorkPlan,
  sendAgentInput, stopAgentWork, resumeAgentWork, cancelAgentInput, postAgentMessage,
  type AgentWorkList, type AgentInputRow, type AgentMessageRow, type PlanProgress, type AgentWorkRow,
} from '../agent-work-api.ts';

/** M09 agent work surface: typed child work list with role/owner/worktree/
 * state/budget/evidence freshness, Send now vs After current input modes,
 * real delivery status (never optimistic), task tree progress and the
 * task-scoped message board. Parent stop/archive revokes dispatch. */
export function AgentWorkPanel({threadId}: {threadId: string}) {
  const [list, setList] = useState<AgentWorkList | null>(null);
  const [inputs, setInputs] = useState<AgentInputRow[]>([]);
  const [messages, setMessages] = useState<AgentMessageRow[]>([]);
  const [plan, setPlan] = useState<PlanProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<{workId: string; output: unknown} | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [post, setPost] = useState({recipientThreadId: '', topic: '', text: ''});
  const [open, setOpen] = useState(false);
  const busy = useRef(false);
  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const next = await getAgentWork(threadId);
      setList(next); setPlan(await getAgentWorkPlan(threadId)); setMessages((await getAgentWorkMessages(threadId)).messages);
      // Every active child's queue is shown — inputs to any child get real
      // delivery status and cancellation controls.
      const targets = next.works.filter(work => work.state === 'RUNNING' || work.state === 'QUEUED').map(work => work.owner.threadId);
      setInputs((await Promise.all(targets.map(owner => getAgentWorkInputs(threadId, owner)))).flatMap(batch => batch.inputs));
      setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Agent work unavailable'); }
    finally { busy.current = false; }
  }, [threadId]);
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), 4000); return () => clearInterval(timer); }, [refresh]);
  if (error && !list) return null;
  if (!list || list.works.length === 0) return null;
  const progress = plan?.extension ? plan.progress : undefined;
  const progressLabel = progress ? `${progress.total ? Math.round(progress.completed / progress.total * 100) : 0}% known complete · ${progress.total ? Math.round(progress.unknown / progress.total * 100) : 0}% unknown` : undefined;

  const send = (work: AgentWorkRow, kind: 'STEER' | 'FOLLOW_UP') => {
    const text = (drafts[work.workId] ?? '').trim(); if (!text) return;
    void sendAgentInput(threadId, {workId: work.workId, kind, text}).then(() => { setDrafts(d => ({...d, [work.workId]: ''})); return refresh(); }).catch(e => setError(e instanceof Error ? e.message : 'Send failed'));
  };
  return <section className="agents-work" aria-label="Agent work">
    <button type="button" className="agents-disclosure" aria-expanded={open} onClick={() => setOpen(!open)}>Agent work · {list.works.length}</button>
    {open && <div className="agents-work-body">
      <div className="agents-work-meta">roles: {Object.entries(list.roles).map(([role, r]) => `${role}${r.available ? '' : ' (unavailable)'}`).join(', ')} · budget reserved {list.budget.reservedTokens}tok</div>
      {progress && <div className="agents-work-progress">
        <progress aria-label="Task progress" aria-valuetext={progressLabel} max={progress.total || 1} value={progress.completed}/><span>{progressLabel}</span>
      </div>}
      {list.works.map(work => <article key={work.workId} className="agents-work-row" data-state={work.state}>
        <header>
          <strong>{work.role}</strong>
          <span className="agents-work-meta" title={work.owner.threadId}>owner {work.owner.threadId.slice(0, 8)}</span>
          {work.worktree && <span className="agents-work-meta" title={work.worktree}>{work.worktree.split(/[\\/]/).pop()}</span>}
          <span className="agents-work-state" data-state={work.state}>{work.state.replaceAll('_', ' ')}{work.blockedReason ? ` — ${work.blockedReason}` : ''}</span>
          <span className="agents-work-meta">{work.budget.tokens !== null ? `${work.budget.tokens}tok ` : ''}{work.evidence.refs ? `${work.evidence.stale}/${work.evidence.refs} refs stale` : 'no evidence yet'}</span>
          <button type="button" className="agents-icon" aria-label={`Open evidence for ${work.workId}`} onClick={() => { void getAgentWorkOutput(threadId, work.workId).then(setOutput).catch(e => setError(e instanceof Error ? e.message : 'Evidence unavailable')); }}><Eye size={14}/></button>
          {(work.state === 'RUNNING' || work.state === 'QUEUED') && <button type="button" className="agents-icon" aria-label={`Stop ${work.workId}`} onClick={() => { void stopAgentWork(threadId, work.workId).then(refresh).catch(e => setError(e instanceof Error ? e.message : 'Stop failed')); }}><Square size={13}/></button>}
          {work.state === 'INTERRUPTED' && <button type="button" className="agents-icon" aria-label={`Resume ${work.workId}`} onClick={() => { void resumeAgentWork(threadId, work.workId).then(refresh).catch(e => setError(e instanceof Error ? e.message : 'Resume failed')); }}><Play size={13}/></button>}
        </header>
        <div className="agents-work-send">
          <input aria-label={`Message work ${work.workId}`} placeholder="Steer or queue a follow-up…" value={drafts[work.workId] ?? ''} onChange={e => setDrafts(d => ({...d, [work.workId]: e.target.value}))} disabled={work.state !== 'RUNNING' && work.state !== 'QUEUED'}/>
          <button type="button" disabled={work.state !== 'RUNNING' || !work.steerSupported} title={work.steerSupported ? 'Delivered to the running child immediately' : 'This work does not support live steering'} onClick={() => send(work, 'STEER')}>Steer now</button>
          <button type="button" disabled={work.state !== 'RUNNING' && work.state !== 'QUEUED'} onClick={() => send(work, 'FOLLOW_UP')}>Queue next</button>
        </div>
      </article>)}
      {inputs.length > 0 && <div className="agents-work-queue" aria-label="Queued inputs">
        {inputs.filter(input => input.delivery === 'ACCEPTED' || input.delivery === 'ENTERED_RUNTIME').map(input => <div key={input.inputId} className="agents-work-input" data-delivery={input.delivery}>
          <span className="agents-work-meta">#{input.order}</span><span className="agents-input-kind">{input.kind}</span><span className="agents-input-text">{input.text}</span>
          <span className="agents-input-delivery">{input.delivery.replaceAll('_', ' ').toLowerCase()}</span>
          {input.editable && <button type="button" className="agents-icon" aria-label="Cancel input" onClick={() => { void cancelAgentInput(threadId, input.targetOwner.threadId, input.inputId).then(refresh).catch(e => setError(e instanceof Error ? e.message : 'Cancel failed')); }}><Ban size={13}/></button>}
        </div>)}
      </div>}
      {output && <pre className="agents-work-output" aria-label="Work output evidence"><button type="button" className="agents-disclosure" onClick={() => setOutput(null)}>Close evidence</button>{JSON.stringify(output.output, null, 2).slice(0, 4000)}</pre>}
      {messages.length > 0 || list.works.length ? <details className="agents-work-board">
        <summary>Message board · {messages.length}</summary>
        {messages.map(message => <div key={message.messageId} className="agents-board-row">
          <span className="agents-work-meta">{message.senderTitle} → {message.recipientTitle}</span>
          <strong>{message.topic}</strong><span className="agents-input-text">{message.text ?? '[artifact]'}</span>
          <span className="agents-input-delivery">{message.receipt.status.toLowerCase()}</span>
        </div>)}
        {list.works.length > 0 && <div className="agents-board-post">
          <Select aria-label="Recipient" value={post.recipientThreadId} onValueChange={value => setPost(p => ({...p, recipientThreadId: value}))}
            options={[{value: '', label: 'Choose recipient…', disabled: true}, ...list.works.map(work => ({value: work.owner.threadId, label: `${work.role} ${work.owner.threadId.slice(0, 8)}`}))]}/>
          <input aria-label="Topic" placeholder="Topic" value={post.topic} onChange={e => setPost(p => ({...p, topic: e.target.value}))}/>
          <input aria-label="Message" placeholder="Message…" value={post.text} onChange={e => setPost(p => ({...p, text: e.target.value}))}/>
          <button type="button" disabled={!post.recipientThreadId || !post.topic || !post.text} onClick={() => { void postAgentMessage(threadId, {recipientThreadId: post.recipientThreadId, topic: post.topic, text: post.text}).then(() => { setPost({recipientThreadId: '', topic: '', text: ''}); return refresh(); }).catch(e => setError(e instanceof Error ? e.message : 'Post failed')); }}>Post</button>
        </div>}
      </details> : null}
      {error && <p className="agents-error" role="alert">{error}</p>}
    </div>}
  </section>;
}
