import {useEffect, useRef, useState} from 'react';
import {rpc,Resource,useResource,Detail,Card,ErrorMessage,Table,chainIdNumber} from '@synergy-network/portal-native/dapp-sdk';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {readProtocolObservation} from '@synergy-network/dapp-data-view/protocol-observations';
import {RpcSyncHistory} from './RpcSyncHistory.jsx';
import {rpcReadinessWithSync} from './rpc-sync-observation.js';
import {sameSyncChain} from './rpc-sync-history.js';
import {confirmReportedGenesis, genesisDigest} from './genesis-pin.js';
import {PublicRpcScopeError, runPublicSyncCapture, syncCaptureAttempts, syncCaptureDeadlineMs, syncCaptureIntervalMs} from './rpc-sync-capture.js';

const captureFindings = {
 reported: 'Reported local head',
 advanced: 'Local head advanced',
 regressed: 'Local head regressed',
 unchanged: 'Local head unchanged at the reported reference',
 'unchanged-behind': 'Local head unchanged while the reference is ahead',
 'manager-unavailable': 'Sync manager unavailable',
 'tip-unavailable': 'Local chain tip unavailable',
 'reference-below-head': 'Reported reference below local head',
 unsupported: 'Sync progress unsupported',
 unavailable: 'RPC read unavailable',
 'timed-out': 'RPC read timed out',
};
const captureColumns = [
 {key: 'attempt', label: 'Read'},
 {key: 'receivedAt', label: 'Time UTC', render: row => new Date(row.receivedAt).toISOString()},
 {key: 'current', label: 'RPC local block'},
 {key: 'highest', label: 'Highest observed block'},
 {key: 'gap', label: 'Block gap'},
 {key: 'change', label: 'Local block change'},
 {key: 'kind', label: 'Finding', render: row => captureFindings[row.kind]},
];
const captureStatuses = {
 running: 'Public sync capture running.',
 completed: 'Public sync capture finished.',
 stopped: 'Public sync capture stopped.',
 'scope-changed': 'Public sync capture ended because access or the reported chain context changed. Its observations cannot be saved.',
 'timed-out': 'Public sync capture ended after a read timed out.',
 failed: 'Public sync capture could not finish.',
};

function PublicSyncSummary({sync, error}) {
 return <section aria-label="RPC synchronization observation">
  <h3>RPC synchronization</h3>
  <ErrorMessage error={error}/>
  {sync && <>
   {sync.mode === 'manager-unavailable' && <p>The RPC reports its sync manager is unavailable. Rerun the readiness read to obtain progress.</p>}
   {sync.mode === 'tip-unavailable' && <p>The RPC reports the local chain tip is unavailable.</p>}
   <Detail data={{
    rpcLocalBlock: sync.current ?? 'Unavailable',
    rpcHighestObservedBlock: sync.highest,
    rpcBlockGap: sync.mode === 'reported' ? sync.gap ?? 'Observed height below local block' : 'Unavailable',
    rpcManagerState: sync.managerState,
    rpcReportedSyncing: sync.syncing,
    rpcReportedPercentage: sync.percentage === undefined ? undefined : `${sync.percentage}%`,
   }}/>
  </>}
  <p>These values describe a single public RPC response. Managed-host progress and participation require separate authenticated evidence.</p>
 </section>;
}

export function RpcReadiness({profile,permitted,canRead = () => permitted}){
 const scope = JSON.stringify([profile.id, profile.rpc, profile.chainId, profile.genesisHash ?? null, permitted]);
 return <RpcReadinessReport key={scope} profile={profile} permitted={permitted} canRead={canRead}/>;
}

function RpcReadinessReport({profile, permitted, canRead}) {
 const [capture,setCapture] = useState({status:'idle', rows:[], samples:[]});
 const captureRef = useRef(null);
 const manualPending = useRef(false);
 const currentReadPermission = useRef(canRead);
 currentReadPermission.current = canRead;
 const reading = capture.status === 'running';
 const pin = genesisDigest(profile.genesisHash);
 const invalidPin = profile.genesisHash != null && !pin;
 const mayRead = () => permitted && currentReadPermission.current();

 function ensureCurrent(signal) {
  signal.throwIfAborted();
  if (!mayRead()) throw new PublicRpcScopeError('Allow public NodeNetwork reads in Security & permissions.');
 }

 function read(signal) {
  ensureCurrent(signal);
  if (invalidPin) throw new PublicRpcScopeError('The configured RPC Genesis pin is invalid.');
  const scopedRpc = async (method, params, options) => {
   ensureCurrent(signal);
   const value = await rpc(method, params, options);
   ensureCurrent(signal);
   if (method === 'synergy_getChainId') {
    let actual;
    try {actual = chainIdNumber(value);} catch {}
    if (actual !== Number(profile.chainId)) {
     throw new PublicRpcScopeError('Selected RPC chain identity does not match the observation context');
    }
   }
   return value;
  };
  return readProtocolObservation(scopedRpc, 'synergy_getReadiness', profile, signal, (value, expected) => {
   const report = rpcReadinessWithSync(value, expected);
   if (pin) {
    try {confirmReportedGenesis(report.chain.genesis, pin);}
    catch (error) {throw new PublicRpcScopeError(error.message);}
   }
   return report;
  });
 }

 const observation = useResource(async signal => {
  try {
   const report = await read(signal);
   if (!signal.aborted) setCapture(current => {
    const capturedChain = current.samples[0]?.chain;
    return capturedChain && !sameSyncChain(capturedChain,report.chain)
     ? {...current,status:'scope-changed',samples:[]} : current;
   });
   return report;
  } catch (error) {
   if (!signal.aborted && error instanceof PublicRpcScopeError) setCapture(current => current.samples.length
    ? {...current,status:'scope-changed',samples:[]} : current);
   throw error;
  }
  finally {manualPending.current = false;}
 }, 'readiness-report');

 useEffect(() => () => {
  const controller = captureRef.current;
  captureRef.current = null;
  controller?.abort();
 }, []);

 const readDisabled = !permitted || invalidPin || observation.loading || reading;

 function refresh() {
  if (readDisabled || captureRef.current || manualPending.current || !mayRead()) return;
  manualPending.current = true;
  observation.reload();
 }

 async function startCapture() {
  if (readDisabled || captureRef.current || manualPending.current || !mayRead()) return;
  const controller = new AbortController();
  captureRef.current = controller;
  setCapture({status:'running', rows:[], samples:[]});
  let status;
  try {
   status = await runPublicSyncCapture({
    read, canRead:mayRead, initialChain:observation.data?.chain,
    onAttempt(row, report) {
     if (captureRef.current !== controller || controller.signal.aborted) return;
     setCapture(current => ({
      status:current.status,
      rows:[...current.rows,row],
      samples:report ? [...current.samples,report] : current.samples,
     }));
    },
   }, controller.signal);
  } catch {
   status = 'failed';
  } finally {
   if (captureRef.current === controller) {
    captureRef.current = null;
    setCapture(current => ({...current,status,
     samples:status === 'scope-changed' || status === 'failed' ? [] : current.samples,
    }));
   }
  }
 }

 const saveable = ['completed','stopped','timed-out'].includes(capture.status);
 return <Card title="Public RPC readiness report">
  <p>This describes the selected RPC server only. It does not select, authenticate or qualify a managed host, VPN, signer, validator activation or participation.</p>
  <Resource value={{...observation,reload:readDisabled ? null : refresh}}>{value => <>
   <SourceAge source="Selected public RPC readiness read" updatedAt={value.receivedAt}/>
   <Detail data={{rpcReportedReady: value.reportedReady, reportedHealth: value.status, chainStateAvailable: value.chainStateAvailable, reportedFailClosed: value.failClosed, reportedHeight: value.height ?? 'Unavailable', reportedNetwork: value.chain.network, reportedIncarnation: value.chain.incarnation, reportedGenesis: value.chain.genesis}}/>
   <PublicSyncSummary sync={value.sync} error={value.syncError}/>
   <p>Server-reported context is not independently verified. Filesystem paths, raw health errors and other server details are excluded.</p>
  </>}</Resource>
  <button disabled={readDisabled} onClick={refresh}>Refresh RPC readiness report</button>
  {permitted && <>
   <section aria-label="Public RPC sync capture">
    <h3>Public RPC sync capture</h3>
    <p>Capture up to {syncCaptureAttempts} public readiness reads. Each read has a {syncCaptureDeadlineMs / 1000}-second limit and the next begins {syncCaptureIntervalMs / 1000} seconds after it settles. Use saved sync history to retain supported observations.</p>
    <div className="native-actions">
     <button disabled={readDisabled} onClick={startCapture}>Start public sync capture</button>
     {reading && <button onClick={() => captureRef.current?.abort()}>Stop public sync capture</button>}
    </div>
    {captureStatuses[capture.status] && <p role="status">{captureStatuses[capture.status]}</p>}
    {capture.rows.length > 0 && <Table rows={capture.rows} columns={captureColumns}/>}
   </section>
   <RpcSyncHistory profile={profile} observation={observation.data} refreshing={observation.loading}
    capturing={reading} captured={saveable ? capture.samples : []}
    canSaveNow={() => mayRead() && !captureRef.current && !manualPending.current}/>
  </>}
 </Card>;
}
