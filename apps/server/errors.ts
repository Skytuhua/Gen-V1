import type {FastifyReply} from 'fastify';
import {statusForError,type ApiErrorCode,type ErrorBody} from '../../packages/contracts/errors.ts';

// Single writer for the JSON error envelope so every route emits
// {error:{code,message,details?}} with a status derived from the code.
// Callers pass an explicit status only where the wire status predates
// the taxonomy map and must be preserved.
export function sendError(reply:FastifyReply,code:ApiErrorCode,message:string,options?:{status?:number;details?:unknown}) {
  const body:ErrorBody={error:{code,message,...(options?.details!==undefined?{details:options.details}:{})}};
  return reply.code(options?.status??statusForError(code)).send(body);
}
