/** Promptfoo custom provider: the host alone selects account, model and billing. */
export default class HarnessProvider {
 constructor(options={}){this.label=options.id??'harness-native';}
 id(){return this.label;}
 async callApi(prompt){
  const endpoint=process.env.HARNESS_PROMPTFOO_BRIDGE_URL,token=process.env.HARNESS_PROMPTFOO_BRIDGE_TOKEN;
  if(!endpoint||!token)throw Error('The native Harness evaluation adapter is unavailable');
  const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({prompt}),signal:AbortSignal.timeout(300000)});
  const result=await response.json();if(!response.ok)throw Error(result.error??'Native evaluation failed');
  return {output:result.output,...(result.usage?{tokenUsage:{prompt:result.usage.inputTokens,completion:result.usage.outputTokens,total:typeof result.usage.inputTokens==='number'&&typeof result.usage.outputTokens==='number'?result.usage.inputTokens+result.usage.outputTokens:undefined}}:{})};
 }
}
