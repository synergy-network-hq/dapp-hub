import {useState} from 'react';
import {Detail, ErrorMessage, ModalDialog, Resource, Table, useResource} from '@synergy-network/portal-native/dapp-sdk';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {downloadJson} from './download-json.js';
import {filterValidatorBlocks, reviewValidatorBlocks, validatorBlockWindows} from './validator-blocks.js';
import {queryableValidatorBlock} from './validator-rpc-block.js';

const columns = [
 {key: 'number', label: 'Block'},
 {key: 'hash', label: 'Reported hash'},
 {key: 'blockTimestamp', label: 'Block time UTC'},
 {key: 'indexedAt', label: 'Indexed time UTC'},
 {key: 'transactions', label: 'Transactions reported'},
];

export function ValidatorBlockReview({observation, readRpcBlock}) {
 const [windowId, setWindowId] = useState('all');
 const [review, setReview] = useState(null);
 const [error, setError] = useState('');
 const [selection, setSelection] = useState(null);
 const blocks = observation.indexedBlocks;
 const rows = Array.isArray(blocks) ? filterValidatorBlocks(blocks, windowId, observation.receivedAt) : null;
 const selected = readRpcBlock && selection?.observation === observation && rows?.includes(selection.row) ? selection : null;
 const attribution = useResource(signal => selected ? readRpcBlock(observation.address, selected.row, signal) : null, selected);
 const visibleColumns = readRpcBlock ? [...columns, {key:'rpc',label:'Selected RPC',render:row => queryableValidatorBlock(row)
  ? <button onClick={() => setSelection({observation,row})} aria-label={`Check RPC attribution for block ${row.number}`}>Check attribution</button>
  : 'Unsupported block identity'}] : columns;

 return <details>
  <summary>Recent indexed blocks</summary>
  <p>Atlas returns up to 50 attributed blocks. The time filter applies within this response. Finality, managed duty coverage and live participation require separate evidence.</p>
  {rows === null ? <p role="status">Indexed block observations are unavailable.</p> : <>
   <label>Indexed block interval
    <select value={windowId} onChange={event => {setWindowId(event.target.value); setSelection(null); setReview(null); setError('');}}>
     {validatorBlockWindows.map(window => <option key={window.id} value={window.id}>{window.label}</option>)}
    </select>
   </label>
   <p role="status">{rows.length} of {blocks.length} returned blocks within the interval.</p>
   <Table rows={rows} columns={visibleColumns} empty="No returned blocks in this interval."/>
   <button disabled={!rows.length} onClick={() => {
    setError('');
    setReview(reviewValidatorBlocks(observation, windowId));
   }}>Review indexed blocks export</button>
  </>}
  {selected && <section aria-label="Selected RPC block attribution">
   <h3>Block {selected.row.number} attribution</h3>
   <Resource value={attribution}>{result => <>
    <p>The selected RPC reports a finalized block with the same height, hash and validator as Atlas.</p>
    <Detail data={{blockHeight:result.height,blockHash:result.hash,validatorAddress:result.address,reportedIncarnation:result.incarnation}}/>
    <SourceAge source="Selected public RPC authority-signature block read" updatedAt={result.receivedAt}/>
    <p>Independent proof verification and validator activation require separate evidence.</p>
   </>}</Resource>
   <button onClick={() => setSelection(null)}>Clear RPC attribution check</button>
  </section>}
  {review && <ModalDialog label="Review indexed blocks export" onClose={() => setReview(null)}>
   <h2>Review indexed blocks export</h2>
   <p>This summary contains the public validator address, source receipt and block observations in the selected interval.</p>
   <pre>{JSON.stringify(review, null, 2)}</pre>
   <ErrorMessage error={error}/>
   <button data-initial-focus onClick={() => setReview(null)}>Cancel</button>
   <button onClick={() => {
    try {
     downloadJson('nodenetwork-indexed-blocks.json', review);
     setReview(null);
    } catch {
     setError('The device could not save the indexed block summary.');
    }
   }}>Save reviewed indexed blocks</button>
  </ModalDialog>}
 </details>;
}
