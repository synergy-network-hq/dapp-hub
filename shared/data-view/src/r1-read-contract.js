// Wire validation only; the expected coordinate must come from independently
// authenticated Genesis authority. Matching these fields never verifies a proof.
// Mirrors Core synergy-rpc/r1_read.rs and protocol-types/network_r1.rs.
const fail = () => { throw Error('Unsupported R1 public read contract.'); };
const object = (value, fields) => value && typeof value === 'object' && !Array.isArray(value)
 && Object.keys(value).length === fields.length && fields.every(key=>Object.hasOwn(value,key));
const decimal = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value)
 && BigInt(value) <= 18446744073709551615n;
function profile(value) {
 if (!object(value,['name','revision']) || typeof value.name !== 'string'
  || !/^[!-~]{1,128}$/.test(value.name) || !Number.isInteger(value.revision)
  || value.revision < 1 || value.revision > 4294967295) return fail();
 return {name:value.name,revision:value.revision};
}
function digest(value, algorithm, bytes, tagged = false) {
 if (!object(value, tagged?['profile','algorithm','encoding','value']:['algorithm','encoding','value'])
  || value.algorithm !== algorithm || value.encoding !== 'lowercase-hex'
  || typeof value.value !== 'string' || value.value.length !== bytes*2
  || /[^0-9a-f]/.test(value.value)) return fail();
 return {...(tagged?{profile:profile(value.profile)}:{}),algorithm,encoding:'lowercase-hex',value:value.value};
}
export function r1NetworkCoordinate(value) {
 if (!object(value,['chain_id','network_incarnation_commitment','genesis_commitment','activated_profiles','identity_profile','presentation_version'])
  || !decimal(value.chain_id) || value.chain_id === '0' || value.presentation_version !== 2) return fail();
 const identity = profile(value.identity_profile);
 const genesis = digest(value.genesis_commitment,'SHA3-384',48,true);
 if (identity.name !== 'APQE-NATIVE-ID' || identity.revision !== 1
  || genesis.profile.name !== 'SYNERGY-GENESIS-R1' || genesis.profile.revision !== 1) return fail();
 return {
  chain_id:value.chain_id,
  network_incarnation_commitment:digest(value.network_incarnation_commitment,'SHA3-512',64),
  genesis_commitment:genesis,
  activated_profiles:digest(value.activated_profiles,'SHA3-512',64,true),
  identity_profile:identity,presentation_version:2,
 };
}
export function sameR1NetworkCoordinate(reported, expected) {
 try {return JSON.stringify(r1NetworkCoordinate(reported)) === JSON.stringify(r1NetworkCoordinate(expected));}
 catch {return false;}
}
const emptyMethods = new Set(['synergy_getBlockNumber','synergy_getFinalizedHead','synergy_getChainId','synergy_genesisHash']);
const accountMethods = new Set(['synergy_getAccount','synergy_getBalance','synergy_getAccountNonce']);
const transactionMethods = new Set(['synergy_getTransaction','synergy_getTransactionReceipt','synergy_getTransactionStatus']);
export function r1PublicReadRequest(method, args, expectedCoordinate, requestId) {
 const network = r1NetworkCoordinate(expectedCoordinate);
 if (typeof requestId !== 'string' || !/^[!-~]{1,128}$/.test(requestId)) return fail();
 let parsed;
 if (emptyMethods.has(method)) {
  if (!object(args,[])) return fail();
  parsed = {};
 } else if (accountMethods.has(method)) {
  if (!object(args,['address']) && !object(args,['address','at_height'])) return fail();
  if (typeof args.address !== 'string' || !/^(synw|syns|syna|synm|synu|synq)\.2\.[A-Za-z0-9_-]{64}$/.test(args.address)
   || args.at_height != null && !decimal(args.at_height)) return fail();
  parsed = {address:args.address,...(Object.hasOwn(args,'at_height')?{at_height:args.at_height}:{})};
 } else if (transactionMethods.has(method)) {
  if (!object(args,['transaction_id']) || typeof args.transaction_id !== 'string'
   || !/^syntxn[A-Za-z0-9_-]{64}$/.test(args.transaction_id)) return fail();
  parsed = {transaction_id:args.transaction_id};
 } else if (method === 'synergy_getBlock') {
  if ((!object(args,['height']) && !object(args,['block_commitment']) && !object(args,['height','block_commitment']))
   || (args.height != null) === (args.block_commitment != null)) return fail();
  if (args.height != null) {
   if (!decimal(args.height)) return fail();
   parsed = {height:args.height,...(Object.hasOwn(args,'block_commitment')?{block_commitment:null}:{})};
  } else {
   parsed = {...(Object.hasOwn(args,'height')?{height:null}:{}),block_commitment:digest(args.block_commitment,'SHA3-384',48,true)};
  }
 } else return fail();
 return {api_version:1,request_id:requestId,caller_scope:'public_read',network,args:parsed};
}
