// Source: testnet-v3 runtime RPC at05610db7. These are unverified endpoint reports.
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const token=value=>typeof value==='string'&&value.length>0&&value.length<=256&&!/[\x00-\x20\x7f]/.test(value);
export function unsignedObservation(value){
 if(typeof value==='number'){if(!Number.isSafeInteger(value)||value<0)throw Error('Unsafe reported integer');value=String(value);}
 if(typeof value!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(value)||BigInt(value)>18446744073709551615n)throw Error('Unsupported reported integer');
 return value;
}
function chainObservation(value,expected){
 if(!object(value)||value.chain_id!==Number(expected)||!Number.isSafeInteger(value.chain_id)||value.chain_id<=0||!token(value.network_id)||!token(value.genesis_hash))throw Error('Reported chain context is unavailable or mismatched');
 return {chainId:value.chain_id,network:value.network_id,incarnation:unsignedObservation(value.chain_incarnation),genesis:value.genesis_hash};
}
export function feeMarketObservation(value,expected=1266){
 if(!object(value)||value.version!==1||typeof value.enabled!=='boolean'||value.feeAsset!=='SNRG'||value.source!=='protocol'||value.integer_base_units!==true||!object(value.current)||!object(value.next)||!object(value.pq)||!object(value.priorityFee)||value.priorityFee.enabled!==false||value.priorityFee.recommended!==null)throw Error('Fee-market response is unavailable or unsupported; no fee quote is inferred');
 const chain=chainObservation(value.chain,expected),currentBlock=unsignedObservation(value.current.blockNumber),nextBlock=unsignedObservation(value.next.blockNumber);
 if(BigInt(nextBlock)!==BigInt(currentBlock)+1n)throw Error('Fee-market block context changed or is unsupported');
 return {chain,enabled:value.enabled,currentBlock,nextBlock,currentBaseFeeNwei:unsignedObservation(value.current.baseFeePerGas),nextBaseFeeNwei:unsignedObservation(value.next.baseFeePerGas),nextPqGasPriceNwei:unsignedObservation(value.next.effectivePqGasPrice),pqMultiplier:unsignedObservation(value.pq.multiplier),receivedAt:Date.now()};
}
export function rpcReadinessObservation(value,expected){
 if(!object(value)||typeof value.ready!=='boolean'||!object(value.health)||!['healthy','degraded','quarantined'].includes(value.health.status)||typeof value.health.chain_state_available!=='boolean'||typeof value.health.fail_closed!=='boolean'||value.ready!==(value.health.status==='healthy')||value.health.fail_closed===value.health.chain_state_available||(value.ready&&!value.health.chain_state_available))throw Error('RPC readiness response is unavailable or inconsistent; no ready state is inferred');
 const chain=chainObservation(value.chain,expected),healthChain=chainObservation(value.health.chain,expected);
 if(JSON.stringify(chain)!==JSON.stringify(healthChain))throw Error('RPC readiness chain contexts disagree');
 const height=value.health.latest_height==null?null:unsignedObservation(value.health.latest_height);
 if(value.health.chain_state_available&&height===null)throw Error('RPC readiness omitted available chain height');
 return {chain,reportedReady:value.ready,status:value.health.status,chainStateAvailable:value.health.chain_state_available,failClosed:value.health.fail_closed,height,receivedAt:Date.now()};
}
export async function readProtocolObservation(request,method,endpoint,signal,parse){
 if(signal?.aborted)throw signal.reason;
 const expected=Number(endpoint.chainId),id=await request('synergy_getChainId',[],{endpoint:endpoint.rpc,signal});
 const actual=typeof id==='string'&&/^0x[0-9a-f]+$/i.test(id)?Number.parseInt(id,16):typeof id==='string'&&/^[0-9]+$/.test(id)?Number(id):id;
 if(!Number.isSafeInteger(expected)||expected<=0||actual!==expected)throw Error('Selected RPC chain identity does not match the observation context');
 if(signal?.aborted)throw signal.reason;
 const value=await request(method,[],{endpoint:endpoint.rpc,signal});if(signal?.aborted)throw signal.reason;
 return parse(value,expected);
}
