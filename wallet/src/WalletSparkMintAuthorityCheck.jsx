import {useState} from 'react';
import {Detail, Resource, rpcNftMintAuthorityObservation, useResource} from '@synergy-network/portal-native/dapp-sdk';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {matchesCollectibleReadiness} from './collectible-observations.js';
import {requireWalletReadScope} from './wallet-account-read.js';
import {readNftWalletReadiness} from './wallet-owner-readiness.js';
import {exactRpcAmount, maxU64} from './rpc-unsigned.js';
import {STS_TESTNET_GENESIS} from './wallet-address.js';

const reports = new Map([
  ['match', 'The reported mint authority matches the draft sender.'],
  ['different', 'The reported mint authority differs from the draft sender.'],
  ['renounced', 'The reported collection has no mint authority.'],
]);
const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

export function WalletSparkMintAuthorityCheck({draft, endpoint, canRead}) {
  const [revision, setRevision] = useState(0);
  const observation = useResource(async signal => {
    if (!revision) return null;
    const checkScope = () => requireWalletReadScope(signal, canRead);
    const readiness = await readNftWalletReadiness(draft.sender, endpoint, signal, checkScope);
    checkScope();
    let outcome;
    try {
      outcome = await rpcNftMintAuthorityObservation({endpoint: endpoint.rpc, signal,
        collectionId: draft.collectionId, sender: draft.sender});
    } catch {
      checkScope();
      throw Error('Current NF1 mint authority evidence is unavailable from the selected RPC.');
    }
    checkScope();
    const {value, chainContext} = outcome ?? {};
    const snapshotHeight = exactRpcAmount(value?.snapshotHeight, maxU64);
    const headHeight = exactRpcAmount(value?.headHeight, maxU64);
    if (chainContext?.genesis !== STS_TESTNET_GENESIS || !matchesCollectibleReadiness(chainContext, readiness) ||
        value?.collectionId !== draft.collectionId || !reports.has(value.status) || !hash(value.snapshotHash) ||
        !hash(value.headHash) || !headHeight || headHeight === '0' || !snapshotHeight ||
        BigInt(snapshotHeight) < BigInt(headHeight) || (snapshotHeight === headHeight && value.snapshotHash !== value.headHash)) {
      throw Error('The mint authority evidence does not match this draft and the selected RPC context.');
    }
    return {status: value.status, snapshotHeight, snapshotHash: value.snapshotHash,
      headHeight, headHash: value.headHash, receivedAt: Date.now()};
  }, revision);

  return <section aria-label="NFT mint authority check">
    <p>This check compares the draft sender with the mint authority reported by the selected RPC. Portal sends only the public collection ID.</p>
    <button type="button" disabled={revision > 0 && observation.loading} onClick={() => setRevision(value => value + 1)}>
      {revision ? 'Check mint authority again' : 'Check reported mint authority'}
    </button>
    {revision > 0 && canRead() && <Resource value={{...observation, reload: undefined}}>{value => <>
      <p role="status">{reports.get(value.status)}</p>
      <SourceAge source="Selected RPC NF1 collection snapshot" updatedAt={value.receivedAt}/>
      <Detail data={{reportedSnapshotHeight: value.snapshotHeight, reportedSnapshotHash: value.snapshotHash,
        reportedFinalizedHeadHeight: value.headHeight, reportedFinalizedHeadHash: value.headHash}}/>
    </>}</Resource>}
  </section>;
}
