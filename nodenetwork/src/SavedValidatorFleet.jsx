import {useState} from 'react';
import {Card, Detail, ErrorMessage, Table} from '@synergy-network/portal-native/dapp-sdk';
import {readSavedValidatorFleet} from './saved-validator-fleet.js';
import {useObservationFile} from './useObservationFile.js';

const healthLabel = code => code.charAt(0) + code.slice(1).toLowerCase().replaceAll('_',' ');
const columns = [
 {key:'id',label:'Reported validator'},
 {key:'health',label:'Health at capture',render:row=>healthLabel(row.health)},
 {key:'headHeight',label:'Head'},
 {key:'finalizedHeight',label:'Finalized'},
 {key:'syncTargetHeight',label:'Sync target'},
];

function FleetFindings({report}) {
 const [filter,setFilter] = useState('all');
 const [selected,setSelected] = useState(null);
 const {rows,unavailable,sharedChain,commonHead,commonFinalized,returnedQuorum,reportedDivergence,reportedAt} = report;
 const health = [...new Set(rows.map(row=>row.health))].sort();
 const shown = rows.filter(row => filter === 'all' || row.health === filter);
 const detail = shown.find(row=>row.id === selected);
 return <section aria-label="Saved validator fleet findings">
  <p role="status">{rows.length} returned validator records · {unavailable.length} unavailable in this capture</p>
  {reportedAt && <p>Cluster status reported {reportedAt}.</p>}
  {sharedChain ? <Detail data={{network:sharedChain.network,chainId:sharedChain.chainId,incarnation:sharedChain.incarnation,
    commonHead:commonHead ?? 'Unavailable',commonFinalized:commonFinalized ?? 'Unavailable',
    quorumAcrossReturnedValidators:returnedQuorum ? 'Reported available' : 'Reported unavailable',
    clusterDivergence:reportedDivergence ? 'Reported divergence or incomplete scope' : 'No indication recorded'}}/>
   : rows.length > 0 && <p>The returned validators report mixed chain contexts. Review each captured record separately.</p>}
  {unavailable.length > 0 && <details>
   <summary>Unavailable validators in this capture</summary>
   <ul>{unavailable.map(id=><li key={id}>{id}</li>)}</ul>
  </details>}
  {rows.length > 0 && <label>Captured health <select value={filter} onChange={event=>{setFilter(event.target.value);setSelected(null);}}>
   <option value="all">All reported states</option>
   {health.map(code=><option key={code} value={code}>{healthLabel(code)}</option>)}
  </select></label>}
  <Table rows={shown} columns={columns} onSelect={row=>setSelected(row.id)} empty="No returned validators match this view."/>
  {detail && <section aria-label="Selected saved validator details">
   <h4>{detail.id}</h4>
   <Detail data={{statusObservedAt:detail.capturedAt,network:detail.network,chainId:detail.chainId,
    incarnation:detail.incarnation,serviceState:detail.serviceState,reportedHealth:healthLabel(detail.health),
    headHeight:detail.headHeight,finalizedHeight:detail.finalizedHeight,syncTargetHeight:detail.syncTargetHeight}}/>
   {detail.releaseDifferences.length > 0 && <>
    <h5>Reported release differences</h5>
    <ul>{detail.releaseDifferences.map(field=><li key={field}>{field.replaceAll('_',' ')}</li>)}</ul>
   </>}
   <button onClick={()=>setSelected(null)}>Close saved validator details</button>
  </section>}
 </section>;
}

function FleetFile({canRead}) {
 const {result,error,reading,revision,clear,select} = useObservationFile((file,current) => {
  if (!canRead()) throw Error('NodeNetwork inspection is unavailable for this cluster status.');
  return readSavedValidatorFleet(file,() => current() && canRead());
 });
 return <>
  <p>Choose a saved Validator Operations v1 cluster status JSON to review reported validator health, heights and release differences. Live fleet status requires an authenticated reader.</p>
  <label>Saved cluster status JSON <input type="file" accept=".json,application/json" onChange={select}/></label>
  {(result || error || reading) && <button onClick={clear}>Clear saved fleet status</button>}
  {reading && <p role="status">Reading saved cluster status…</p>}
  <ErrorMessage error={error}/>
  {result && <FleetFindings key={revision} report={result}/>}
 </>;
}

export function SavedValidatorFleet({permitted,canRead = () => permitted}) {
 return <Card title="Saved validator fleet status">
  {permitted ? <FleetFile canRead={canRead}/>
   : <p>Allow NodeNetwork inspection in Security &amp; permissions to review a saved cluster status.</p>}
 </Card>;
}
