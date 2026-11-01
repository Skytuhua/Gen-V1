import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk';
import { messageInputIds } from '../runtime-pi/input-envelope.ts';

const [sessionId, dir, threadId] = process.argv.slice(2);
if (!sessionId || !dir || !threadId) process.exit(1);
const messages = await getSessionMessages(sessionId, { dir });
const receipts = messages.filter(message => message.type === 'user').flatMap(message => {
  const inputIds = messageInputIds(message.message as { role?: unknown; content?: unknown });
  const content = (message.message as any)?.content;
  const text = typeof content === 'string' ? content : content?.[0]?.text;
  if (!inputIds.length || typeof text !== 'string') return [];
  try { const marker = JSON.parse(text.slice('[harness-input:v1] '.length, text.indexOf('\n'))); return marker.threadId === threadId ? [{ uuid: message.uuid, inputIds }] : []; }
  catch { return []; }
});
process.stdout.write(JSON.stringify(receipts));
