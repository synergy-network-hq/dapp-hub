import {readProtocolObservation, rpcReadinessObservation} from '@synergy-network/dapp-data-view/protocol-observations';
import {confirmReportedGenesis,genesisDigest} from './genesis-pin.js';

export function networkComparisonScope(selected,references,permitted) {
 const context=endpoint=>[endpoint.id,endpoint.rpc,endpoint.chainId,endpoint.networkKey,endpoint.name,endpoint.genesisHash??null];
 return JSON.stringify([context(selected),references.map(context),permitted]);
}

function endpointUrl(value) {
 if (typeof value !== 'string' || !value) return null;
 try {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
  url.hash = '';
  return url.href;
 } catch {
  return null;
 }
}

export function canCompareEndpoint(selected, reference) {
 const expected = Number(selected?.chainId);
 const sourceUrl = endpointUrl(selected?.rpc);
 const referenceUrl = endpointUrl(reference?.rpc);
 return Boolean(sourceUrl && referenceUrl && sourceUrl !== referenceUrl && selected.id !== reference.id
  && Number.isSafeInteger(expected) && expected > 0 && Number(reference.chainId) === expected);
}

export async function readNetworkComparison(request, selected, reference, signal) {
 if (!canCompareEndpoint(selected, reference)) throw Error('Choose a distinct RPC configured for the same chain ID.');
 signal?.throwIfAborted();
 // Check both configured pins before contacting either endpoint. Agreement
 // between two RPCs cannot override a configured network identity.
 const endpoints=[selected,reference];
 const pins=endpoints.map(endpoint=>{
  const pin=genesisDigest(endpoint.genesisHash);
  if(endpoint.genesisHash!=null&&!pin)throw Error('The configured comparison Genesis pin is invalid.');
  return pin;
 });
 const inspect = async (endpoint,index) => {
  const report=await readProtocolObservation(request, 'synergy_getReadiness', endpoint, signal, rpcReadinessObservation);
  if(pins[index])confirmReportedGenesis(report.chain.genesis,pins[index]);
  return report;
 };
 const outcomes = await Promise.allSettled(endpoints.map(inspect));
 signal?.throwIfAborted();
 const [current, baseline] = outcomes.map(outcome => outcome.status === 'fulfilled'
  ? {chain: outcome.value.chain, receivedAt: outcome.value.receivedAt}
  : null);
 if (!current || !baseline) return {outcome: 'unavailable', selected: current, reference: baseline, differences: []};

 const differences = ['chainId', 'network', 'incarnation', 'genesis'].filter(field => current.chain[field] !== baseline.chain[field]);
 return {outcome: differences.length ? 'mismatch' : 'match', selected: current, reference: baseline, differences};
}
