import {sourceRecords} from './source-records.js';
import {Detail} from '@synergy-network/portal-native/dapp-sdk';
import {amount,text} from '@synergy-network/dapp-data-view';
import {indexedTransactionTime} from './WalletActivity.jsx';
export function WalletTransactionDetails({data,hash}){
 const matches=sourceRecords(data?.recentTransactions,'Transaction history').records.filter(row=>row.hash===hash),row=matches.length===1?matches[0]:null,time=row?indexedTransactionTime(row):null;
 return <aside aria-label="Indexed transaction details"><h3>Indexed transaction details</h3>{row?<><Detail data={{hash:text(row.hash),indexedStatus:text(row.status),sender:text(row.sender_address??row.sender??row.from),receiver:text(row.receiver_address??row.receiver??row.to),reportedSNRG:amount(row.amount_nwei),reportedBlock:text(row.block_number??row.blockNumber),reportedTimeUTC:time?new Date(time.ms).toISOString():'Unavailable',timeSource:time?.source||'Unavailable'}}/><p>This is the current Atlas record, not independently verified inclusion or authoritative finality. Reorganization and chain-incarnation checks are not established by this view.</p></>:<p role="status">The selected record is absent or ambiguous in the current source response. Previous details are not shown.</p>}</aside>;
}
