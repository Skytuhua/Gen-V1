import {HarnessError,type StartRun} from '../contracts/index.ts';
import {encodeInput} from '../runtime-pi/input-envelope.ts';

export const MODEL_ONLY_MAX_PROMPT_BYTES=16*1024*1024;
export const MODEL_ONLY_MAX_WIRE_BYTES=32*1024*1024;
export const MODEL_ONLY_SYSTEM_PROMPT='You are a text-model transport for Hermes. The harness-input envelope is transport metadata; follow the complete text in its JSON prompt field. Return the requested model text verbatim, including any <tool_call> blocks for Hermes to execute. In tool-call text, use a JSON object for function.arguments rather than an escaped JSON string, and keep commentary outside the block. Do not execute tools, read or write files, invoke agents, or perform actions outside that text.';

export function assertModelOnlyInput(input:StartRun):void{
 if(typeof input.prompt!=='string'||Buffer.byteLength(input.prompt)>MODEL_ONLY_MAX_PROMPT_BYTES||Buffer.byteLength(encodeInput(input))>MODEL_ONLY_MAX_WIRE_BYTES)throw new HarnessError('MODEL_ONLY_INPUT_LIMIT','The model transport prompt exceeds its bounded input limit.');
}
