import {useEffect, useState} from 'react';
import {Detail, ErrorMessage, Table, useResource} from '@synergy-network/portal-native/dapp-sdk';
import {readSyncHistory, saveSyncSample, selectSyncHistory, syncHistoryKey, syncHistoryLimit, syncHistoryRows, syncHistorySource} from './rpc-sync-history.js';

const columns = [
 {key: 'received', label: 'Receipt time UTC'},
 {key: 'current', label: 'RPC local block'},
 {key: 'highest', label: 'Highest observed block'},
 {key: 'gap', label: 'Block gap'},
 {key: 'change', label: 'Local block change'},
];

function loadHistory() {
 try {
  return {history: readSyncHistory(), error: ''};
 } catch (error) {
  return {history: null, error: error.message};
 }
}

export function RpcSyncHistory({profile, observation, refreshing}) {
 const [saved, setSaved] = useState(loadHistory);
 const [lastChain, setLastChain] = useState(null);
 const [saveError, setSaveError] = useState('');
 const source = useResource(() => syncHistorySource(profile), 'public-sync-history-source');
 const reportedChain = observation?.chain;
 const samples = saved.history && source.data
  ? selectSyncHistory(saved.history, source.data, reportedChain ?? lastChain, profile.genesisHash) : [];
 const latest = samples[0];
 const supported = observation?.sync?.mode === 'reported';
 const canSave = Boolean(saved.history && source.data && supported && !refreshing && (!latest || latest.receivedAt < observation.receivedAt));

 useEffect(() => {
  if (reportedChain) setLastChain(reportedChain);
 }, [reportedChain]);

 function reload() {
  setSaved(loadHistory());
  setSaveError('');
 }

 useEffect(() => {
  function onStorage(event) {
   if (event.key === syncHistoryKey || event.key === null) reload();
  }
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
 }, []);

 return <section aria-label="Saved public sync history">
  <h3>Saved public sync history</h3>
  <p>Save supported observations from the selected public RPC to compare reported heights over time. This device retains the newest {syncHistoryLimit} saved samples across all RPCs. The samples describe the reporting RPC. Managed sync and stall classification require authenticated telemetry.</p>
  {refreshing && <p role="status">Refreshing the public RPC. Saved values are historical.</p>}
  {!refreshing && !observation && <p role="status">Current public RPC readiness is unavailable. Saved values are historical.</p>}
  {observation && !supported && <p role="status">This read has no supported sync progress to save.</p>}
  <ErrorMessage error={saved.error || source.error || saveError}/>
  {latest && <Detail data={{reportedNetwork: latest.chain.network, chainId: latest.chain.chainId, reportedIncarnation: latest.chain.incarnation, reportedGenesis: latest.chain.genesis}}/>}
  {saved.history && source.data && <Table rows={syncHistoryRows(samples)} columns={columns} empty="No saved samples match this RPC and reported chain context."/>}
  <div className="native-actions">
   <button disabled={!canSave} onClick={() => {
    if (!canSave) return;
    setSaveError('');
    try {setSaved({history: saveSyncSample(source.data, observation), error: ''});}
    catch (error) {setSaveError(error.message);}
   }}>Save current public sync sample</button>
   <button onClick={reload}>Reload saved sync history</button>
  </div>
 </section>;
}
