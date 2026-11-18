import {useState} from 'react';
import {Detail, Table} from '@synergy-network/portal-native/dapp-sdk';
import {amount} from '@synergy-network/dapp-data-view';

const snrg = value => `${amount(value)} SNRG`;
const columns = [
 {key: 'originalEpoch', label: 'Original epoch'},
 {key: 'pendingNwei', label: 'Pending', render: row => snrg(row.pendingNwei)},
 {key: 'releasedNwei', label: 'Released', render: row => snrg(row.releasedNwei)},
 {key: 'reportedStatus', label: 'Reported status'},
];

export function ValidatorRewardSettlements({settlements}) {
 const [selectedEpoch, setSelectedEpoch] = useState(null);
 const selected = settlements?.find(row => row.originalEpoch === selectedEpoch);

 return <details>
  <summary>Indexed validator reward settlements</summary>
  <p>Atlas returns up to 12 recent indexed settlements for this validator. Eligibility, fees, claimable balances and finality require separate chain evidence.</p>
  {settlements === null && <p role="status">Atlas reward settlement evidence is unavailable or unsupported.</p>}
  {settlements?.length === 0 && <p role="status">Atlas returned no settlement rows. This source gives no reward balance for an empty result.</p>}
  {Boolean(settlements?.length) && <Table
   rows={settlements.map(row => ({...row, id: row.originalEpoch}))}
   columns={columns}
   onSelect={row => setSelectedEpoch(row.originalEpoch)}
  />}
  {selected && <section aria-label="Selected reward settlement">
   <h4>Epoch {selected.originalEpoch} settlement</h4>
   <Detail data={{
    accountabilityEpoch: selected.accountabilityEpoch,
    unlockEpoch: selected.unlockEpoch,
    pending: snrg(selected.pendingNwei),
    released: snrg(selected.releasedNwei),
    treasuryRecovery: snrg(selected.treasuryRecoveryNwei),
    penalty: snrg(selected.penaltyNwei),
    reportedPayoutAddress: selected.payoutAddress ?? 'Unavailable',
    reportedSettlementTransaction: selected.settlementTxHash ?? 'Unavailable',
   }}/>
   <button onClick={() => setSelectedEpoch(null)}>Close settlement details</button>
  </section>}
 </details>;
}
