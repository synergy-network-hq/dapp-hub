import {useId, useRef, useState} from 'react';
import {Detail, Resource, rpcTokenBalanceObservation} from '@synergy-network/portal-native/dapp-sdk';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {reportedTokenQuantity, rpcSingleTokenBalance} from './token-balance-inventory.js';
import {isStsFungibleObjectId} from './wallet-address.js';
import {useWalletOwnerSnapshot} from './wallet-owner-readiness.js';

function TokenBalanceResult({account, endpoint, tokenId, canRead}) {
  const {observation} = useWalletOwnerSnapshot({account, endpoint, canRead, startOnMount: true,
    read: ({endpoint, signal, owner}) => rpcTokenBalanceObservation({endpoint, signal, owner, tokenId}),
    parse: (response, owner, readiness) => rpcSingleTokenBalance(response, owner, readiness, tokenId),
    unavailable: 'The token balance is unavailable from the selected RPC.'});

  return <Resource value={{...observation, reload: undefined}}>{({item, height, hash, receivedAt}) => <>
    <SourceAge source="Selected RPC token balance snapshot" updatedAt={receivedAt}/>
    {!item && <p role="status">The selected RPC did not recognize this token in the reported snapshot.</p>}
    <Detail data={{tokenId, reportedTokenSnapshotHeight: height, reportedTokenSnapshotHash: hash,
      ...(item ? {symbol: item.symbol, reportedDecimals: item.decimals,
        reportedQuantity: reportedTokenQuantity(item, 'rpc').value, reportedAtomicQuantity: item.raw,
        reportedFreezeFlag: item.frozen ? 'Frozen' : 'Clear'} : {})}}/>
    {item && <p>Spendability remains unverified.</p>}
  </>}</Resource>;
}

export function WalletRpcTokenBalance({account, endpoint, canRead}) {
  const [input, setInput] = useState('');
  const [request, setRequest] = useState(null);
  const [invalid, setInvalid] = useState(false);
  const revision = useRef(0);
  const errorId = useId();

  function check(event) {
    event.preventDefault();
    if (!canRead()) return;
    if (!isStsFungibleObjectId(input)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setRequest({tokenId: input, revision: ++revision.current});
  }

  return <section aria-label="Exact STS token balance">
    <h3>Check a specific token</h3>
    <form onSubmit={check}>
      <label>Exact STS fungible token ID<input value={input} maxLength={44} autoComplete="off" autoCapitalize="none" spellCheck={false}
        aria-invalid={invalid} aria-describedby={invalid ? errorId : undefined} onChange={event => {
          revision.current++;
          setInput(event.target.value);
          setInvalid(false);
          setRequest(null);
        }}/></label>
      {invalid && <p id={errorId} role="alert">Enter the exact checksummed STS fungible token ID.</p>}
      <button type="submit">Check token balance</button>
    </form>
    {request && <TokenBalanceResult key={request.revision} tokenId={request.tokenId} {...{account, endpoint}}
      canRead={() => request.revision === revision.current && canRead()}/>}
  </section>;
}
