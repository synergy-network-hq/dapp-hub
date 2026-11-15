import {useState} from 'react';
import {ErrorMessage, ModalDialog, Table} from '@synergy-network/portal-native/dapp-sdk';
import {downloadJson} from './download-json.js';
import {filterValidatorBlocks, reviewValidatorBlocks, validatorBlockWindows} from './validator-blocks.js';

const columns = [
 {key: 'number', label: 'Block'},
 {key: 'hash', label: 'Reported hash'},
 {key: 'blockTimestamp', label: 'Block time UTC'},
 {key: 'indexedAt', label: 'Indexed time UTC'},
 {key: 'transactions', label: 'Transactions reported'},
];

export function ValidatorBlockReview({observation}) {
 const [windowId, setWindowId] = useState('all');
 const [review, setReview] = useState(null);
 const [error, setError] = useState('');
 const blocks = observation.indexedBlocks;
 const rows = Array.isArray(blocks) ? filterValidatorBlocks(blocks, windowId, observation.receivedAt) : null;

 return <details>
  <summary>Recent indexed blocks</summary>
  <p>Atlas returns up to 50 attributed blocks. The time filter applies within this response. Finality, managed duty coverage and live participation require separate evidence.</p>
  {rows === null ? <p role="status">Indexed block observations are unavailable.</p> : <>
   <label>Indexed block interval
    <select value={windowId} onChange={event => {setWindowId(event.target.value); setReview(null); setError('');}}>
     {validatorBlockWindows.map(window => <option key={window.id} value={window.id}>{window.label}</option>)}
    </select>
   </label>
   <p role="status">{rows.length} of {blocks.length} returned blocks within the interval.</p>
   <Table rows={rows} columns={columns} empty="No returned blocks in this interval."/>
   <button disabled={!rows.length} onClick={() => {
    setError('');
    setReview(reviewValidatorBlocks(observation, windowId));
   }}>Review indexed blocks export</button>
  </>}
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
