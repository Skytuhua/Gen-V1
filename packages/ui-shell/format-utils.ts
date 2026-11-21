export function errorMessage(cause:unknown,fallback:string):string{
  return cause instanceof Error?cause.message:fallback;
}

export function clamp(value:number,minimum:number,maximum:number):number{
  return Math.min(maximum,Math.max(minimum,value));
}
