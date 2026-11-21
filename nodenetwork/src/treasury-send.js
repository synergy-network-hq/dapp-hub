const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const pin=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function treasuryTransfer(receiver,amount){
 if(typeof receiver!=='string'||!/^syna1[a-z0-9]{10,123}$/.test(receiver)||typeof amount!=='string'||!/^([1-9][0-9]{0,38})$/.test(amount)||BigInt(amount)>=(1n<<128n))throw Error('Enter an ordinary syna recipient and positive integer nWei amount.');
 return {receiver,amount_nwei:amount};
}
export function treasuryQuote(v){
 if(!exact(v,['schema','quote_sha256','sender','network_id','chain_id','finalized_height','receiver','amount_nwei','nonce','observed_balance_nwei','fee_nwei','formation_sha256','genesis_sha256','authority_coverage'])||v.schema!=='nodenetwork-native-treasury-quote-v1'||!pin(v.quote_sha256)||!pin(v.formation_sha256)||!pin(v.genesis_sha256)||!['signed-formation-e1-only','signed-formation-autonomous-lineage-v1'].includes(v.authority_coverage)||v.fee_nwei!=='840000'||!Number.isSafeInteger(v.nonce)||v.nonce<0||!Number.isSafeInteger(v.finalized_height)||v.finalized_height<1||typeof v.sender!=='string'||!v.sender.startsWith('syna1')||typeof v.observed_balance_nwei!=='string'||!/^(0|[1-9][0-9]*)$/.test(v.observed_balance_nwei))throw Error('Unsupported native treasury quote.');
 treasuryTransfer(v.receiver,v.amount_nwei);return v;
}
export function treasuryPrepared(v){
 if(!exact(v,['schema','request_sha256','formation_sha256','genesis_sha256','transaction_id','receipt_id','admission_sha256','sender','receiver','amount_nwei','nonce','fee_nwei','state','automatic_retry'])||v.schema!=='nodenetwork-formation-treasury-send-v1'||!['prepared','dispatch_unknown'].includes(v.state)||v.automatic_retry!==false||!Number.isSafeInteger(v.nonce)||v.nonce<0||!['request_sha256','formation_sha256','genesis_sha256','transaction_id','admission_sha256'].every(k=>pin(v[k]))||!(/^[a-f0-9]{128}$/).test(v.receipt_id)||v.fee_nwei!=='840000')throw Error('Unsupported native immutable treasury intent.');
 treasuryTransfer(v.receiver,v.amount_nwei);return v;
}
export function treasuryObservation(v){
 if(!exact(v,['schema','prepared','finalized_observation','account_observations','automatic_retry'])||v.schema!=='nodenetwork-treasury-send-status-v1'||v.automatic_retry!==false)throw Error('Unsupported treasury send observation.');
 treasuryPrepared(v.prepared);const f=v.finalized_observation;
 if(f!==null&&(!exact(f,['transaction_id','block_height','block_hash','finality_certificate_id','status'])||f.transaction_id!==v.prepared.transaction_id||!pin(f.block_hash)||!Number.isSafeInteger(f.block_height)||f.block_height<1||!['applied','reverted'].includes(f.status)||!pin(f.finality_certificate_id)))throw Error('Unsupported finalized treasury observation.');
 const a=v.account_observations;
 if(f===null||f.status!=='applied'){if(a!==null)throw Error('Unfinalized account observations are unsupported.');return v;}
 if(!exact(a,['schema','sender','receiver'])||a.schema!=='nodenetwork-treasury-accounts-v1')throw Error('Unsupported finalized account observations.');
 for(const role of ['sender','receiver']){const x=a[role];if(!exact(x,['address','balance_nwei','nonce','finalized_height','finalized_block_hash','state_root'])||x.address!==v.prepared[role]||typeof x.balance_nwei!=='string'||!/^(0|[1-9][0-9]{0,38})$/.test(x.balance_nwei)||BigInt(x.balance_nwei)>=(1n<<128n)||!Number.isSafeInteger(x.nonce)||x.nonce<0||x.finalized_height!==f.block_height||x.finalized_block_hash!==f.block_hash||!pin(x.state_root))throw Error('Mismatched finalized account context.');}
 if(a.sender.state_root!==a.receiver.state_root||a.sender.nonce<=v.prepared.nonce)throw Error('Mismatched finalized account state or consumed nonce.');return v;
}

export function treasurySendError(value){
 const text=typeof value==='string'?value:value instanceof Error?value.message:'';
 return text.length>0&&text.length<=512&&!/[\x00-\x1f\x7f]/.test(text)?text:'Outcome unavailable. Read original nonce status; never resubmit an uncertain intent.';
}
export function treasuryPhase(v){
 if(!exact(v,['schema','request_sha256','nonce','authorization_sha256','grant_state','audit_state','reservation','files','request_matches','mutation_performed'])||v.schema!=='nodenetwork-treasury-send-phase-v1'||!pin(v.request_sha256)||!pin(v.authorization_sha256)||!Number.isSafeInteger(v.nonce)||v.nonce<0||v.mutation_performed!==false||!['absent','exact','different'].includes(v.grant_state)||!['not_consumed','consumed'].includes(v.audit_state)||!['absent','partial','complete_inventory_unverified'].includes(v.reservation)||!exact(v.files,['request','prepared','admission','dispatch'])||!Object.values(v.files).every(h=>h===null||pin(h))||!(v.request_matches===null||typeof v.request_matches==='boolean'))throw Error('Unsupported read-only treasury phase.');
 const absent=Object.values(v.files).every(h=>h===null),empty='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',complete=['request','prepared','admission'].every(k=>v.files[k]!==null&&v.files[k]!==empty);
 if((v.reservation==='absent'&&!absent)||(v.reservation==='complete_inventory_unverified')!==complete||(v.files.request===null)!==(v.request_matches===null)||(v.files.request!==null&&v.request_matches!==(v.files.request===v.request_sha256)))throw Error('Inconsistent treasury phase inventory.');
 return v;
}

export function treasuryNotApplied(v){
 if(!exact(v,['schema','record_id','request_sha256','nonce','not_applied','prepared','automatic_retry'])||v.schema!=='nodenetwork-native-treasury-not-applied-v1'||!pin(v.record_id)||!pin(v.request_sha256)||!Number.isSafeInteger(v.nonce)||v.nonce<0||v.not_applied!==true||v.prepared!==false||v.automatic_retry!==false)throw Error('Unsupported treasury nonapplication receipt.');return v;
}
