import {rpc,Resource,useResource,Detail,Card,ErrorMessage} from '@synergy-network/portal-native/dapp-sdk';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {readProtocolObservation} from '@synergy-network/dapp-data-view/protocol-observations';
import {RpcSyncHistory} from './RpcSyncHistory.jsx';
import {rpcReadinessWithSync} from './rpc-sync-observation.js';
import {confirmReportedGenesis, genesisDigest} from './genesis-pin.js';

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

export function RpcReadiness({profile,permitted}){
 const scope = JSON.stringify([profile.id, profile.rpc, profile.chainId, profile.genesisHash ?? null, permitted]);
 return <RpcReadinessReport key={scope} profile={profile} permitted={permitted}/>;
}

function RpcReadinessReport({profile, permitted}) {
 const observation = useResource(signal => {
  if (!permitted) throw Error('Allow public NodeNetwork reads in Security & permissions.');
  const pin = genesisDigest(profile.genesisHash);
  if (profile.genesisHash != null && !pin) throw Error('The configured RPC Genesis pin is invalid.');
  return readProtocolObservation(rpc, 'synergy_getReadiness', profile, signal, (value, expected) => {
   const report = rpcReadinessWithSync(value, expected);
   if (pin) confirmReportedGenesis(report.chain.genesis, pin);
   return report;
  });
 }, 'readiness-report');
 return <Card title="Public RPC readiness report">
  <p>This describes the selected RPC server only. It does not select, authenticate or qualify a managed host, VPN, signer, validator activation or participation.</p>
  <Resource value={observation}>{value => <>
   <SourceAge source="Selected public RPC readiness read" updatedAt={value.receivedAt}/>
   <Detail data={{rpcReportedReady: value.reportedReady, reportedHealth: value.status, chainStateAvailable: value.chainStateAvailable, reportedFailClosed: value.failClosed, reportedHeight: value.height ?? 'Unavailable', reportedNetwork: value.chain.network, reportedIncarnation: value.chain.incarnation, reportedGenesis: value.chain.genesis}}/>
   <PublicSyncSummary sync={value.sync} error={value.syncError}/>
   <p>Server-reported context is not independently verified. Filesystem paths, raw health errors and other server details are excluded.</p>
  </>}</Resource>
  <button disabled={!permitted || observation.loading} onClick={observation.reload}>Refresh RPC readiness report</button>
  {permitted && <RpcSyncHistory profile={profile} observation={observation.data} refreshing={observation.loading}/>}
 </Card>;
}
