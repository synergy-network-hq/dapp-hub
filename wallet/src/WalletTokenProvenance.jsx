import {useState} from 'react';
import {atlas, Resource, useNative, useResource} from '@synergy-network/portal-native/dapp-sdk';
import {atlasAccountKey} from './atlas-account.js';
import {tokenBalanceSource} from './token-balance-inventory.js';
import {blockHeight} from './transaction-observation.js';

const tokenLabel = value => typeof value === 'string' && value.length > 0 && value.length <= 128 &&
  !/[\u0000-\u001f\u007f]/.test(value);

function selectedContract(item) {
  if (tokenBalanceSource(item) !== 'synq') return null;
  const address = item.contractAddress;
  if (typeof address !== 'string' || address.trim() !== address || !/^syn[a-z0-9]{35,93}$/.test(address) ||
      item.assetKey !== `synq:${address}`) return null;
  const deployedBlock = blockHeight(item.deployedBlock);
  const tokenStandard = item.tokenStandard ?? 'Token';
  if (deployedBlock === null || !tokenLabel(item.symbol) || !tokenLabel(tokenStandard)) return null;
  return {address, deployedBlock, tokenStandard, symbol: item.symbol};
}

function contractObservation(value, selected) {
  const tags = value?.tags;
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.address !== selected.address ||
      blockHeight(value.deployedBlock) !== selected.deployedBlock || !Array.isArray(tags) || tags.length !== 3 ||
      tags[0] !== 'SynQ' || tags[1] !== selected.tokenStandard || tags[2] !== selected.symbol) {
    throw Error('Atlas returned a different or unsupported token contract record.');
  }
  if (typeof value.verified !== 'boolean') throw Error('Atlas returned an unsupported contract verification flag.');
  return {
    verified: value.verified,
    bytecodeHash: typeof value.bytecodeHash === 'string' && value.bytecodeHash.length === 64 && /^[0-9a-f]{64}$/.test(value.bytecodeHash)
      ? value.bytecodeHash : null,
  };
}

function ContractLookup({selection, permit}) {
  const [revision, setRevision] = useState(0);
  const check = () => setRevision(value => value + 1);
  const observation = useResource(async signal => {
    if (!revision) return null;
    signal.throwIfAborted();
    if (!permit('wallet', 'readWallet')) throw Error('Wallet contract access is unavailable in this Portal context.');
    let value;
    try {
      value = await atlas(`contracts/${encodeURIComponent(selection.address)}`, {signal});
    } catch {
      throw Error('The Atlas contract check could not be completed. Try again.');
    }
    signal.throwIfAborted();
    if (!permit('wallet', 'readWallet')) throw Error('Wallet contract access is unavailable in this Portal context.');
    return {...contractObservation(value, selection), checkedAt: new Date().toISOString()};
  }, revision);

  if (!revision) return <button onClick={check}>Check Atlas contract record</button>;
  return <section aria-label="Atlas contract observation">
    <h4>Atlas contract registry</h4>
    <Resource value={{...observation, reload: check}}>{value => <>
      <p role="status">{value.verified ? 'Atlas marks this contract verified.' : 'Atlas reports this contract as unverified.'}</p>
      <dl>
        <dt>Atlas deployment block</dt><dd>{selection.deployedBlock}</dd>
        <dt>Reported bytecode hash</dt><dd>{value.bytecodeHash ?? 'Unavailable'}</dd>
      </dl>
      <p>Atlas checked <time dateTime={value.checkedAt}>{value.checkedAt}</time></p>
      <button onClick={check}>Check Atlas contract again</button>
    </>}</Resource>
  </section>;
}

export function WalletTokenProvenance({item, accountKey}) {
  const n = useNative();
  const selection = selectedContract(item);
  const endpoint = n?.endpoint;
  if (!selection || !accountKey || !n?.permit('wallet', 'readWallet') ||
      atlasAccountKey(n.wallet?.connection?.address) !== accountKey || Number(endpoint?.chainId) !== 1266) return null;
  const scope = JSON.stringify([selection, accountKey, endpoint.id, endpoint.rpc, endpoint.networkKey, n.walletConsentSession]);
  return <ContractLookup key={scope} selection={selection} permit={n.permit}/>;
}
