import {useState} from 'react';
import {chainIdNumber, Resource, rpc, useResource} from '@synergy-network/portal-native/dapp-sdk';
import {amount} from '@synergy-network/dapp-data-view';
import {observedSnrgNwei} from './snrg-balance.js';

export function WalletDraftBalanceComparison({account, endpoint, draftNwei, canCompare}) {
  const [revision, setRevision] = useState(0);
  const check = () => setRevision(value => value + 1);
  const observation = useResource(async signal => {
    if (!revision) return null;

    function checkScope() {
      signal.throwIfAborted();
      if (!canCompare()) throw Error('The reviewed recipient or Wallet context changed. Review the draft again.');
    }

    checkScope();
    const options = {endpoint: endpoint.rpc, signal};
    let chain;
    try {
      chain = chainIdNumber(await rpc('synergy_getChainId', [], options));
    } catch {
      throw Error('The selected RPC chain check could not be completed. Try again.');
    }
    checkScope();
    if (chain !== 1266) throw Error('The selected RPC reported a different chain ID.');

    let reported;
    try {
      reported = await rpc('synergy_getBalance', [account], options);
    } catch {
      throw Error('The selected RPC balance check could not be completed. Try again.');
    }
    checkScope();
    const balanceNwei = observedSnrgNwei(reported);
    if (balanceNwei === null) throw Error('The selected RPC returned an unsupported SNRG balance.');

    const difference = BigInt(draftNwei) - BigInt(balanceNwei);
    return {balanceNwei, excessNwei: difference > 0n ? difference.toString() : null, checkedAt: new Date().toISOString()};
  }, revision);

  if (!revision) return <button onClick={check}>Compare with selected RPC balance</button>;
  return <section aria-label="Draft balance comparison">
    <Resource value={{...observation, reload: check}}>{({balanceNwei, excessNwei, checkedAt}) => <>
      <p>Selected RPC reported balance {amount(balanceNwei)} SNRG.</p>
      <p role="status">{excessNwei === null ? 'The draft amount is at or below the reported balance.' :
        `The draft amount exceeds the reported balance by ${amount(excessNwei)} SNRG.`}</p>
      <p>Balance compared <time dateTime={checkedAt}>{checkedAt}</time></p>
      <button onClick={check}>Compare balance again</button>
    </>}</Resource>
  </section>;
}
