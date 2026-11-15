import {useState} from 'react';
import {Card, Resource, chainIdNumber, rpc, useResource} from '@synergy-network/portal-native/dapp-sdk';
import {amount} from '@synergy-network/dapp-data-view';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import background from '../assets/card-backgrounds/graphic1.png';
import {observedSnrgNwei} from './snrg-balance.js';

const cardBackground = {
  backgroundImage: `linear-gradient(90deg,rgba(0,0,0,.7),rgba(0,0,0,.3)),url(${background})`,
};

function useSnrgObservation(request, endpoint, account, method) {
  const [revision, setRevision] = useState(0);
  const staking = method === 'synergy_getStakedBalance';
  const {loading, data, error} = useResource(async signal => {
    signal.throwIfAborted();
    if (Number(endpoint.chainId) !== 1266) throw Error('Select Synergy Testnet chain 1266.');
    const options = {endpoint: endpoint.rpc, signal};
    if (chainIdNumber(await request('synergy_getChainId', [], options)) !== 1266) {
      throw Error('RPC identity does not match chain 1266.');
    }
    signal.throwIfAborted();
    let result;
    try {
      result = await request(method, staking ? [account, 'SNRG'] : [account], options);
    } catch {
      throw Error(staking ? 'The selected RPC did not provide a staked SNRG observation.' :
        'The selected RPC did not provide a wallet balance observation.');
    }
    signal.throwIfAborted();

    let observation = result;
    if (staking) {
      const validShape = result && typeof result === 'object' && !Array.isArray(result);
      observation = validShape ? result.balance : null;
    }
    const value = observedSnrgNwei(observation);
    if (value === null) throw Error('The selected RPC returned an unsupported SNRG quantity.');
    return {value, receivedAt: Date.now()};
  }, JSON.stringify([account, endpoint.id, endpoint.rpc, endpoint.chainId, endpoint.networkKey, method, revision]));

  return {loading, data, error, refresh: () => setRevision(previous => previous + 1)};
}

function RpcBalanceCard({title, buttonLabel, observation}) {
  return <section className="wallet-balance-card" aria-label={title} style={cardBackground}>
    <h3>{title}</h3>
    <Resource value={observation}>{value => <>
      <strong>{amount(value.value)} SNRG</strong>
      <SourceAge updatedAt={value.receivedAt} source="Selected Synergy Core RPC"/>
    </>}</Resource>
    <button disabled={observation.loading} onClick={observation.refresh}>{buttonLabel}</button>
  </section>;
}

export function WalletBalances({account, endpoint, index, indexReceivedAt, readRpc = rpc}) {
  const balance = useSnrgObservation(readRpc, endpoint, account, 'synergy_getBalance');
  const stake = useSnrgObservation(readRpc, endpoint, account, 'synergy_getStakedBalance');
  const indexMatches = typeof account === 'string' && index?.address === account.toLowerCase();
  const indexedBalance = indexMatches ? observedSnrgNwei(index.walletBalanceNwei) : null;
  const indexedStake = indexMatches ? observedSnrgNwei(index.stakedBalanceNwei) : null;
  const atlasBalance = indexedBalance === null ? 'Unavailable' : amount(indexedBalance) + ' SNRG';
  const atlasStake = indexedStake === null ? 'Unavailable' : amount(indexedStake) + ' SNRG';

  return <Card title="SNRG balance observations">
    <div className="native-grid">
      <RpcBalanceCard title="RPC-reported SNRG" buttonLabel="Refresh RPC balance" observation={balance}/>
      <RpcBalanceCard title="RPC-reported staked SNRG" buttonLabel="Refresh RPC stake" observation={stake}/>
    </div>
    <p>Atlas-reported SNRG: {atlasBalance}</p>
    <p>Atlas-reported staked SNRG: {atlasStake}</p>
    <SourceAge updatedAt={indexMatches ? indexReceivedAt : undefined}/>
    {(indexedBalance !== null || indexedStake !== null) && <p>Atlas may report zero when its upstream read is unavailable. Atlas quantities remain separate from selected RPC observations.</p>}
    {balance.data && indexedBalance !== null && <p role="status">{balance.data.value === indexedBalance
      ? 'The reported wallet balance values match. Atlas may still be using a fallback.'
      : 'RPC and Atlas report different wallet balances. Atlas may lag or lack upstream data.'}</p>}
    <p>Spendable balance and stake withdrawal eligibility require separate verification.</p>
  </Card>;
}
