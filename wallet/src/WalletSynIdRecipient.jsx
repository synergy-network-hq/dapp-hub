import {useId, useRef, useState} from 'react';
import {Resource, rpc, rpcSynIdRecipientObservation, useResource} from '@synergy-network/portal-native/dapp-sdk';
import {readProtocolObservation} from '@synergy-network/dapp-data-view/protocol-observations';
import {canSaveContactAddress, contactAddressProfile, isReportedSynIdAddress, STS_TESTNET_GENESIS} from './wallet-address.js';
import {checkConfiguredReceiptGenesis, rpcReceiptReadiness} from './rpc-receipt-observation.js';
import {requireWalletReadScope, useWalletReadScope} from './wallet-account-read.js';
import {matchesReadinessContext} from './ordinary-fee-estimate.js';

function canonicalSynId(input) {
  const name = input.trim().replace(/^@+/, '').toLowerCase();
  const canonical = name.endsWith('.syn') ? name : name + '.syn';
  if (!/^[a-z0-9][a-z0-9-]{2,31}\.syn$/.test(canonical)) {
    throw Error('Enter a SynID with 3–32 letters, numbers or hyphens, starting with a letter or number.');
  }
  return canonical;
}

function canUseSynIdAddress(address) {
  return isReportedSynIdAddress(address) && contactAddressProfile(address) !== 'burn' && canSaveContactAddress(address);
}

export function WalletSynIdRecipient({endpoint, canReview, onUse}) {
  const [input, setInput] = useState('');
  const [request, setRequest] = useState(null);
  const [error, setError] = useState(null);
  const generation = useRef(0);
  const description = useId();
  const scope = JSON.stringify([endpoint.id, endpoint.rpc, endpoint.chainId, endpoint.genesisHash]);
  const canRead = useWalletReadScope(scope, canReview);
  function clear() {
    generation.current++;
    setRequest(null);
    setError(null);
  }

  function lookup(event) {
    event.preventDefault();
    clear();
    if (!canRead()) return;
    try {
      setRequest({id: generation.current, synId: canonicalSynId(input)});
    } catch (failure) {
      setError(failure.message);
    }
  }

  const observation = useResource(async signal => {
    if (!request) return null;
    const checkScope = () => requireWalletReadScope(signal, () => canRead() && request.id === generation.current);
    checkScope();
    const readiness = await readProtocolObservation(async (method, params, options) => {
      checkScope();
      const result = await rpc(method, params, options);
      checkScope();
      return result;
    }, 'synergy_getReadiness', endpoint, signal, rpcReceiptReadiness);
    checkConfiguredReceiptGenesis(readiness.chain, endpoint.genesisHash);
    if (!readiness.reportedReady || readiness.chain.incarnation !== '5' ||
        readiness.chain.genesis.toLowerCase() !== STS_TESTNET_GENESIS) {
      throw Error('SynID lookup requires the supported Testnet v3 Genesis and incarnation.');
    }
    checkScope();
    let reply;
    try {
      reply = await rpcSynIdRecipientObservation({endpoint: endpoint.rpc, signal, synId: request.synId});
    } catch {
      checkScope();
      throw Error('The selected RPC could not provide a supported SynID lookup.');
    }
    checkScope();
    if (reply?.state === 'unavailable') return {state: 'unavailable'};
    if (!matchesReadinessContext(reply?.chainContext, readiness) || reply.synId !== request.synId) {
      throw Error('The reported SynID result does not match this lookup and selected RPC identity.');
    }
    if (reply.state === 'not-reported') return {state: 'not-reported'};
    if (reply.state !== 'reported' || !isReportedSynIdAddress(reply.address)) {
      throw Error('The selected RPC returned unsupported SynID evidence.');
    }
    return {state: 'reported', address: reply.address};
  }, request);

  return <section aria-label="SynID recipient lookup">
    <form onSubmit={lookup}>
      <p id={description}>Only the SynID is sent to the selected RPC. Check the reported address before using it.</p>
      <label>Recipient SynID<input value={input} maxLength={64} autoCapitalize="none" spellCheck={false}
        autoComplete="off" aria-describedby={description} onChange={event => {clear(); setInput(event.target.value);}}/></label>
      <button type="submit" disabled={!!request && observation.loading}>Resolve SynID</button>
    </form>
    {error && <p role="alert" className="native-error">{error}</p>}
    {request && canRead() && <Resource value={{...observation, reload: undefined}}>{result => {
      if (result.state === 'unavailable') return <p role="status">The selected RPC does not expose SynID lookup.</p>;
      if (result.state === 'not-reported') return <p role="status">This RPC reported no mapping for {request.synId}.</p>;
      return <>
        <p role="status">Address reported for {request.synId} <code>{result.address}</code></p>
        {canUseSynIdAddress(result.address) ? <button type="button" onClick={() => {
          if (canRead() && request.id === generation.current) {
            clear();
            onUse(result.address);
          }
        }}>Use address</button> : <p role="status">The reported address is unavailable for a SynID draft recipient.</p>}
      </>;
    }}</Resource>}
  </section>;
}
