import assert from 'node:assert/strict';
import {setImmediate as settle} from 'node:timers/promises';
import {test} from 'node:test';
import {PublicRpcScopeError, runPublicSyncCapture, syncCaptureAttempts, syncCaptureDeadlineMs, syncCaptureIntervalMs} from '../src/rpc-sync-capture.js';
import {readSyncHistory, saveSyncCapture, saveSyncSample, syncHistoryKey, syncHistoryLimit} from '../src/rpc-sync-history.js';

const chain = {chainId:1266, network:'testnet-v3', incarnation:'5', genesis:'fixture-genesis'};
const source = 'a'.repeat(64);
const floor = '9007199254740993';
const high = '9007199254741001';

function observation(receivedAt, current = floor, highest = high, context = chain) {
 const gap = BigInt(highest) - BigInt(current);
 return {receivedAt, chain:context, sync:{mode:'reported', current, highest, gap:gap<0n ? null : String(gap)}};
}

function start(read, controller, options={}) {
 const rows=[], samples=[];
 const done=runPublicSyncCapture({read, canRead:()=>true, initialChain:chain, ...options,
  onAttempt(row,report){rows.push(row);if(report)samples.push(report);},
 },controller.signal);
 return {rows,samples,done};
}

test('runs one readiness sequence at a time and classifies six exact public height observations', async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1_000});
 const observations=[
  observation(1_000), observation(2_000,'9007199254740999'), observation(3_000,'9007199254740999'),
  observation(4_000,'9007199254740997'), observation(5_000,'9007199254741009'),
  {receivedAt:6_000, chain, sync:{mode:'manager-unavailable'}},
 ];
 let calls=0, finishFirst;
 const pending=new Promise(resolve=>{finishFirst=resolve;});
 const controller=new AbortController();
 const capture=start(()=>{
  const index=calls++;
  return index===0 ? pending : Promise.resolve(observations[index]);
 },controller);
 await settle();
 t.mock.timers.tick(syncCaptureIntervalMs);
 assert.equal(calls,1);
 finishFirst(observations[0]);
 await settle();
 t.mock.timers.tick(syncCaptureIntervalMs-1);
 assert.equal(calls,1);
 t.mock.timers.tick(1);
 await settle();
 for(let read=2;read<syncCaptureAttempts;read++){
  t.mock.timers.tick(syncCaptureIntervalMs);
  await settle();
 }
 assert.equal(await capture.done,'completed');
 assert.equal(calls,6);
 assert.deepEqual(capture.rows.map(row=>row.kind),['reported','advanced','unchanged-behind','regressed','reference-below-head','manager-unavailable']);
 assert.deepEqual(capture.rows.slice(0,4).map(row=>[row.gap,row.change]),[['8',null],['2','+6'],['2','0'],['4','-2']]);
 assert.deepEqual(capture.samples,observations.slice(0,4));
});

test('cannot compare heights across an unavailable, unsupported or missing-tip read', async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1_000});
 const observations=[observation(1_000),Error('internal raw error'),observation(3_000),
  {receivedAt:4_000,chain,sync:{mode:'tip-unavailable'}},{receivedAt:5_000,chain,sync:null},observation(6_000,high)];
 const controller=new AbortController();
 const {done,rows,samples}=start(async()=>{
  const next=observations.shift();
  if(next instanceof Error)throw next;
  return next;
 },controller);
 await settle();
 for(let read=1;read<syncCaptureAttempts;read++){
  t.mock.timers.tick(syncCaptureIntervalMs);
  await settle();
 }
 assert.equal(await done,'completed');
 assert.deepEqual(rows.map(row=>row.kind),['reported','unavailable','reported','tip-unavailable','unsupported','reported']);
 assert.equal(rows[5].change,null);
 assert.equal(samples.length,3);
 assert.doesNotMatch(JSON.stringify(rows),/internal raw error/);
});

test('stops on authenticated scope loss or a reported chain change and omits the conflicting row', async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1_000});
 const controller=new AbortController();
 let calls=0;
 const changed=start(async()=>++calls===1 ? observation(1_000) : observation(2_000,floor,high,{...chain,incarnation:'6'}),controller);
 await settle();
 t.mock.timers.tick(syncCaptureIntervalMs);
 assert.equal(await changed.done,'scope-changed');
 assert.equal(changed.rows.length,1);
 assert.equal(calls,2);
 const denied=start(async()=>{throw new PublicRpcScopeError('pin mismatch');},controller);
 assert.equal(await denied.done,'scope-changed');
 assert.deepEqual(denied.rows,[]);
 const guard=start(async()=>{assert.fail('scope loss cannot dispatch a read');},controller,{canRead:()=>false});
 assert.equal(await guard.done,'scope-changed');
});

test('stop and deadline both abort the current read and retire late results', async t=>{
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1_000});
 for(const status of ['stopped','timed-out']){
  let signal, resolve;
  const pending=new Promise(finish=>{resolve=finish;});
  const controller=new AbortController();
  let calls=0;
  const capture=start(current=>{calls++;signal=current;return pending;},controller);
  await settle();
  if(status==='stopped')controller.abort();
  else t.mock.timers.tick(syncCaptureDeadlineMs);
  assert.equal(await capture.done,status);
  assert.equal(signal.aborted,true);
  resolve(observation(1_000));
  t.mock.timers.tick(syncCaptureIntervalMs * syncCaptureAttempts);
  await settle();
  assert.equal(calls,1);
  assert.deepEqual(capture.rows.map(row=>row.kind),status==='timed-out'?['timed-out']:[]);
  assert.deepEqual(capture.samples,[]);
 }
});

test('merges captured history in one bounded local write and leaves rejected input untouched',()=>{
 let raw=null, writes=0;
 const storage={
  getItem(key){assert.equal(key,syncHistoryKey);return raw;},
  setItem(key,value){assert.equal(key,syncHistoryKey);raw=value;writes++;},
 };
 for(let index=1;index<=syncHistoryLimit;index++)saveSyncSample(source,observation(index),storage);
 const batch=[observation(2),observation(25),observation(26,'9007199254740999')];
 const initial=writes;
 const saved=saveSyncCapture(source,batch,storage);
 assert.equal(saved.count,2);
 assert.equal(writes,initial+1);
 assert.equal(saved.history.samples.length,syncHistoryLimit);
 assert.deepEqual(saved.history.samples.slice(0,2).map(sample=>sample.receivedAt),[26,25]);
 assert.deepEqual(readSyncHistory(storage),saved.history);
 assert.equal(saveSyncCapture(source,batch,storage).count,0);
 const before=raw;
 assert.throws(()=>saveSyncCapture(source,[observation(26,high)],storage),/conflicts/);
 assert.throws(()=>saveSyncCapture(source,[observation(27),observation(28,floor,high,{...chain,genesis:'other'})],storage),/inconsistent context/);
 assert.throws(()=>saveSyncCapture(source,[observation(28),observation(27)],storage),/receipt times/);
 assert.throws(()=>saveSyncCapture(source,[observation(28),observation(28)],storage),/receipt times/);
 assert.throws(()=>saveSyncCapture(source,[observation(28,'9007199254741002')],storage),/below its local head/);
 assert.equal(writes,initial+1);
 assert.equal(raw,before);
});
