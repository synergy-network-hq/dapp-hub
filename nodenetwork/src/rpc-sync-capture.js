import {sameSyncChain} from './rpc-sync-history.js';

export const syncCaptureAttempts=6;
export const syncCaptureIntervalMs=15_000;
export const syncCaptureDeadlineMs=30_000;
const timedOut=new Error('Public synchronization read timed out.');

export class PublicRpcScopeError extends Error {}

async function boundedRead(read,signal) {
 const controller=new AbortController();
 const retire=()=>controller.abort(signal.reason);
 if(signal.aborted)retire();
 else signal.addEventListener('abort',retire,{once:true});
 const abort=new Promise((_,reject)=>{
  if(controller.signal.aborted)reject(controller.signal.reason);
  else controller.signal.addEventListener('abort',()=>reject(controller.signal.reason),{once:true});
 });
 const timer=setTimeout(()=>controller.abort(timedOut),syncCaptureDeadlineMs);
 try {return await Promise.race([Promise.resolve().then(()=>{
  controller.signal.throwIfAborted();
  return read(controller.signal);
 }),abort]);}
 finally {clearTimeout(timer);signal.removeEventListener('abort',retire);}
}

function waitForNextAttempt(signal) {
 if(signal.aborted)return Promise.resolve();
 return new Promise(resolve=>{
  const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',finish);resolve();};
  const timer=setTimeout(finish,syncCaptureIntervalMs);
  signal.addEventListener('abort',finish,{once:true});
 });
}

function syncFinding(sync,previous) {
 if(sync?.mode!=='reported')return {kind:sync?.mode??'unsupported'};
 const {current,highest,gap}=sync;
 if(gap===null)return {kind:'reference-below-head',current,highest,gap};
 const change=previous ? BigInt(current)-BigInt(previous.sync.current) : null;
 const kind=change===null?'reported':change>0n?'advanced':change<0n?'regressed'
  :BigInt(gap)>0n?'unchanged-behind':'unchanged';
 return {kind,current,highest,gap,change:change===null?null:`${change>0n?'+':''}${change}`};
}

// A single sequence reads the chain ID and readiness from one selected public RPC.
// Only observations with a supported reference gap become candidates for local history.
export async function runPublicSyncCapture({read,canRead,initialChain,onAttempt},signal) {
 let chain=initialChain;
 let previous=null;
 for(let attempt=1;attempt<=syncCaptureAttempts;attempt++){
  if(signal.aborted)return 'stopped';
  if(!canRead())return 'scope-changed';
  let report;
  try {report=await boundedRead(read,signal);}
  catch(error){
   if(signal.aborted)return 'stopped';
   if(!canRead()||error instanceof PublicRpcScopeError)return 'scope-changed';
   const timeout=error===timedOut;
   onAttempt({attempt,receivedAt:Date.now(),kind:timeout?'timed-out':'unavailable'},null);
   if(timeout)return 'timed-out';
   previous=null;
  }
  if(signal.aborted)return 'stopped';
  if(!canRead())return 'scope-changed';
  if(report){
   if(chain&&!sameSyncChain(chain,report.chain))return 'scope-changed';
   chain=report.chain;
   const finding=syncFinding(report.sync,previous);
   const supported=report.sync?.mode==='reported'&&report.sync.gap!==null;
   onAttempt({attempt,receivedAt:report.receivedAt,...finding},supported?report:null);
   previous=supported?report:null;
  }
  if(attempt<syncCaptureAttempts)await waitForNextAttempt(signal);
 }
 return 'completed';
}
