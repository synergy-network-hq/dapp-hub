const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const pin=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const num=v=>Number.isSafeInteger(v)&&v>=0;
export function consensusTransactionSelector(v){
 if(!exact(v,['transaction_id','sender','receiver','height'])||!pin(v.transaction_id)||!num(v.height)||!v.height||!['sender','receiver'].every(k=>typeof v[k]==='string'&&/^syna1[a-z0-9]{10,123}$/.test(v[k])))throw Error('Enter an exact transaction ID, ordinary sender and recipient, and positive finalized height.');return v;
}
function transactionEvidence(e,finalized){
 if(!exact(e,['kind','selector','transaction','accounts'])||e.kind!=='transaction')return false;
 try{consensusTransactionSelector(e.selector);}catch{return false;}
 const t=e.transaction,a=e.accounts,q=e.selector;
 if(t===null)return a===null;
 if(!exact(t,['transaction_id','block_height','block_hash','finality_certificate_id','status'])||t.transaction_id!==q.transaction_id||t.block_height!==q.height||t.block_height>finalized||!pin(t.block_hash)||!pin(t.finality_certificate_id)||!['applied','reverted'].includes(t.status))return false;
 if(t.status==='reverted')return a===null;
 if(!exact(a,['sender','receiver']))return false;
 for(const role of ['sender','receiver']){const v=a[role];if(!exact(v,['address','balance_nwei','nonce','finalized_height','finalized_block_hash','state_root'])||v.address!==q[role]||typeof v.balance_nwei!=='string'||!/^(0|[1-9][0-9]{0,38})$/.test(v.balance_nwei)||BigInt(v.balance_nwei)>340282366920938463463374607431768211455n||!num(v.nonce)||v.finalized_height!==q.height||v.finalized_block_hash!==t.block_hash||!pin(v.state_root))return false;}
 return a.sender.state_root===a.receiver.state_root;
}
export function consensusObservation(v){
 const invalid=()=>{throw Error('Unsupported current-network consensus observation; no finality is inferred.');};
 if(!exact(v,['schema','scope','process_id','observed_at_unix_ms','epoch','epoch_context_root','finalized_height','commitment','transport','evidence'])||v.schema!=='nodenetwork-consensus-view-v1')invalid();
 const s=v.scope,t=v.transport,c=v.commitment,e=v.evidence;
 if(!exact(s,['network_id','chain_id','genesis_hash','formation_sha256','manifest_sha256'])||typeof s.network_id!=='string'||!s.network_id||s.network_id.length>128||typeof s.chain_id!=='string'||!/^[1-9][0-9]*$/.test(s.chain_id)||!['genesis_hash','formation_sha256','manifest_sha256'].every(k=>pin(s[k]))||!num(v.process_id)||!v.process_id||!num(v.observed_at_unix_ms)||!num(v.finalized_height)||!(v.epoch===null||num(v.epoch))||!(v.epoch_context_root===null||pin(v.epoch_context_root)))invalid();
 if(c!==null&&(!exact(c,['height','block_id','state_root','finality_certificate_id','protected_execution_root'])||!num(c.height)||c.height>v.finalized_height||!['block_id','state_root','finality_certificate_id','protected_execution_root'].every(k=>pin(c[k]))))invalid();
 if(!exact(t,['authenticated_peer_count','apqe_session_count','peers','production_qualified'])||t.production_qualified!==false||!Array.isArray(t.peers)||t.peers.length>256||t.authenticated_peer_count!==t.peers.length||!num(t.apqe_session_count)||t.apqe_session_count>t.peers.length)invalid();
 const ids=new Set();for(const p of t.peers){if(!exact(p,['peer_id','session_id','profile','engineering_only'])||typeof p.peer_id!=='string'||!p.peer_id||p.peer_id.length>128||!(typeof p.session_id==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(p.session_id)&&BigInt(p.session_id)<=18446744073709551615n)||typeof p.engineering_only!=='boolean'||!(p.profile===null||p.profile==='PQ-VSESSION-01-candidate-v1')||ids.has(p.peer_id))invalid();ids.add(p.peer_id);}
 if(e!==null){if(e.kind==='transaction'){if(!transactionEvidence(e,v.finalized_height))invalid();}else if(!['finality','epoch'].includes(e.kind)||!exact(e,e.kind==='epoch'?['kind','selector','sha256','epoch_context_root','bytes']:['kind','selector','sha256','bytes','complete','certificate_verified'])||!num(e.selector)||!e.selector||!pin(e.sha256)||!num(e.bytes)||!e.bytes||e.bytes>4*1024*1024||(e.kind==='epoch'?!pin(e.epoch_context_root):typeof e.complete!=='boolean'||typeof e.certificate_verified!=='boolean'||e.certificate_verified&&!e.complete))invalid();}
 return v;
}
