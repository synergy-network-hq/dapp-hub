import {useId, useRef, useState} from 'react';
import {Detail, Resource, rpcSparkMintReceiptObservation, useResource} from '@synergy-network/portal-native/dapp-sdk';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {matchesCollectibleReadiness} from './collectible-observations.js';
import {exactRpcAmount, maxU64} from './rpc-unsigned.js';
import {comparableTransactionHash} from './transaction-observation.js';
import {requireWalletReadScope} from './wallet-account-read.js';
import {readNftWalletReadiness} from './wallet-owner-readiness.js';
import {STS_TESTNET_GENESIS} from './wallet-address.js';

const reports = new Map([
  ['missing-receipt', 'The selected RPC returned no receipt for this hash. The outcome is unknown.'],
  ['not-finalized', 'The selected RPC has no finalized receipt for this comparison.'],
  ['unrelated-receipt', 'The reported receipt parties do not match the draft sender’s carrier.'],
  ['missing-transaction', 'The selected RPC returned the receipt without its finalized block for comparison.'],
  ['payload-mismatch', 'The reported transaction payload differs from the exact draft bytes.'],
  ['matched-success', 'The reported transaction matches the draft payload and the receipt reports successful execution.'],
  ['matched-failed', 'The reported transaction matches the draft payload and the receipt reports failed execution.'],
]);
const anchorStatuses = new Set(['missing-transaction', 'payload-mismatch', 'matched-success', 'matched-failed']);
const matchStatuses = new Set(['matched-success', 'matched-failed']);

function parseReport(outcome, draft, hash, readiness) {
  const {value, chainContext} = outcome ?? {};
  if (chainContext?.genesis !== STS_TESTNET_GENESIS || chainContext.incarnation !== 5 ||
      !matchesCollectibleReadiness(chainContext, readiness) || value?.hash !== hash || !reports.has(value.status)) {
    const operation = draft.action === 'mint' ? 'mint' : 'sale';
    throw Error(`The Spark ${operation} receipt evidence does not match this draft and the selected RPC context.`);
  }
  const {receipt, payloadSha256, status} = value;
  const height = exactRpcAmount(receipt?.height, maxU64);
  const index = exactRpcAmount(receipt?.index, maxU64);
  if ((anchorStatuses.has(status) ? !height || height === '0' || index === null ||
       typeof receipt.blockHash !== 'string' || !/^[0-9a-f]{64}$/.test(receipt.blockHash) : receipt !== null) ||
      payloadSha256 !== (matchStatuses.has(status) ? draft.payloadSha256 : null)) {
    throw Error('The selected RPC receipt comparison did not report the expected payload and block evidence.');
  }
  return {status, hash, payloadSha256, receipt: receipt ? {height, index, blockHash: receipt.blockHash} : null, receivedAt: Date.now()};
}

export function WalletSparkMintReceiptCheck({draft, endpoint, canRead}) {
  const isMint = draft.action === 'mint';
  const operation = isMint ? 'mint' : 'sale';
  const [input, setInput] = useState('');
  const [request, setRequest] = useState(null);
  const [invalid, setInvalid] = useState(false);
  const current = useRef(null);
  const inputError = useId();
  const observation = useResource(async signal => {
    if (!request) return null;
    const checkScope = () => requireWalletReadScope(signal, () => request === current.current && canRead());
    const readiness = await readNftWalletReadiness(draft.sender, endpoint, signal, checkScope);
    if (readiness.chain.incarnation !== '5') throw Error('The selected RPC does not report the Spark draft’s Testnet incarnation.');
    checkScope();
    let outcome;
    try {
      outcome = await rpcSparkMintReceiptObservation({endpoint: endpoint.rpc, signal, hash: request.hash,
        sender: draft.sender, payloadSha256: draft.payloadSha256});
    } catch {
      checkScope();
      throw Error(`The Spark ${operation} receipt comparison is unavailable from the selected RPC.`);
    }
    checkScope();
    return parseReport(outcome, draft, request.hash, readiness);
  }, request);

  function compare(event) {
    event.preventDefault();
    if (!canRead()) return;
    const typed = comparableTransactionHash(input.trim());
    if (!typed?.kind) {
      setInvalid(true);
      return;
    }
    const next = {hash: `${typed.kind}-${typed.digest}`};
    current.current = next;
    setRequest(next);
    setInvalid(false);
  }

  return <section aria-label={`Spark ${operation} receipt comparison`}>
    <h4>Compare a reported {operation} receipt</h4>
    <p>Portal sends the public transaction hash and the reported receipt block height. The draft comparison stays in Portal.</p>
    <form onSubmit={compare}>
      <label>{isMint ? 'Mint' : 'Sale'} transaction hash<input autoComplete="off" spellCheck={false} maxLength={71} value={input}
        aria-invalid={invalid} aria-describedby={invalid ? inputError : undefined} onChange={event => {
          current.current = null;
          setRequest(null);
          setInvalid(false);
          setInput(event.target.value);
        }}/></label>
      {invalid && <p id={inputError} role="alert">Enter a complete syntxn- or synxxn- transaction hash.</p>}
      <button type="submit" disabled={!!request && observation.loading}>Compare reported receipt</button>
    </form>
    {!!request && canRead() && <Resource value={{...observation, reload: undefined}}>{value => <>
      <p role="status">{reports.get(value.status)}</p>
      <SourceAge source={`Selected RPC ${operation} receipt comparison`} updatedAt={value.receivedAt}/>
      <Detail data={{transactionHash: value.hash, reportedReceiptHeight: value.receipt?.height,
        reportedReceiptBlock: value.receipt?.blockHash, reportedTransactionIndex: value.receipt?.index,
        matchingPayloadSha256: value.payloadSha256}}/>
    </>}</Resource>}
  </section>;
}
