import {useId, useLayoutEffect, useRef, useState} from 'react';
import {sha3_256} from '@noble/hashes/sha3';
import {bytesToHex} from '@noble/hashes/utils';
import {Detail, Resource, rpcNftInstanceObservation, useResource} from '@synergy-network/portal-native/dapp-sdk';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {matchesCollectibleReadiness, nftInstanceObservation} from './collectible-observations.js';
import {readNftWalletReadiness} from './wallet-owner-readiness.js';

const MAX_METADATA_FILE_BYTES = 256 * 1024;

export function WalletRpcNftInstanceCheck({endpoint, selection, inventory, canRead}) {
  const [revision, setRevision] = useState(0);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {mounted.current = false;};
  }, []);

  const observation = useResource(async signal => {
    if (!revision) return null;
    function checkScope() {
      signal.throwIfAborted();
      if (!mounted.current || !canRead()) throw Error('The selected Wallet collectible changed.');
    }
    const readiness = await readNftWalletReadiness(selection.ownerAddress, endpoint, signal, checkScope);
    if (!matchesCollectibleReadiness(inventory.chainContext, readiness)) {
      throw Error('The selected RPC chain identity changed. Refresh the owner NFT snapshot before checking this NFT.');
    }
    checkScope();
    let response;
    try {
      response = await rpcNftInstanceObservation({endpoint: endpoint.rpc, signal, nftId: selection.nftId});
    } catch {
      checkScope();
      throw Error('This NFT is unavailable from the selected RPC. Try again or refresh the inventory.');
    }
    checkScope();
    return nftInstanceObservation(response, selection, inventory, readiness);
  }, revision);

  return <section aria-label="Selected RPC NFT instance check">
    <h4>NFT instance</h4>
    <p>This check sends only the public NFT ID to the selected RPC.</p>
    <button disabled={!!revision && observation.loading} onClick={() => setRevision(value => value + 1)}>
      {revision ? 'Check this NFT again' : 'Check this NFT on selected RPC'}
    </button>
    {!!revision && <Resource value={{...observation, reload: undefined}}>{value => <>
      <SourceAge source="Selected RPC NFT snapshot" updatedAt={value.receivedAt}/>
      <p role="status">{value.sameOwner ? 'The NFT record lists this Wallet as owner.' :
        'The selected RPC reports a different NFT owner. Refresh the inventory.'}</p>
      {value.burned && <p>The selected RPC reports this NFT as burned.</p>}
      <Detail data={{reportedNftStatus: value.status, reportedSerialNumber: value.serial,
        reportedExpiry: value.expiry ? new Date(Number(value.expiry) * 1000).toISOString() : 'No expiry reported',
        reportedTransferable: value.transferable ? 'Yes' : 'No',
        reportedIssuerApprovalRequired: value.issuerApproval ? 'Yes' : 'No',
        reportedMetadataMutable: value.metadataMutable ? 'Yes' : 'No',
        reportedMetadataReference: value.metadataReferencePresent ? 'Present' : 'Unavailable',
        reportedNftMetadataHash: value.metadataHash ?? 'Unavailable',
        reportedNftSnapshotHeight: value.snapshotHeight, reportedNftSnapshotHash: value.snapshotHash}}/>
      {value.metadataReferencePresent && value.metadataHash && canRead() &&
        <NftMetadataFileCheck key={JSON.stringify([revision, value.snapshotHeight, value.snapshotHash, value.metadataHash])}
          expectedHash={value.metadataHash} canRead={canRead}/>}
      <p>The status and policy flags describe the reported snapshot. Transfer eligibility and independent ownership verification remain open.</p>
    </>}</Resource>}
  </section>;
}

function NftMetadataFileCheck({expectedHash, canRead}) {
  const [result, setResult] = useState(null);
  const input = useRef(null);
  const sequence = useRef(0);
  const instructions = useId();
  useLayoutEffect(() => () => {sequence.current++;}, []);

  async function chooseFile(event) {
    const file = event.currentTarget.files?.[0];
    if (!file || !canRead()) return;
    const attempt = ++sequence.current;
    const isCurrent = () => attempt === sequence.current && canRead();
    event.currentTarget.value = '';
    const size = file.size;
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_METADATA_FILE_BYTES) {
      setResult({error: true, text: 'The selected metadata file must be at most 256 KiB.'});
      return;
    }
    setResult({text: 'Checking local metadata file…'});
    let bytes;
    try {
      // Testnet-v3 a6a434f2 CLI hash_file_sha3_256 hashes the exact file bytes.
      bytes = new Uint8Array(await file.arrayBuffer());
      if (!isCurrent()) return;
      if (bytes.byteLength !== size) throw Error('Unexpected metadata file length');
      const matches = bytesToHex(sha3_256(bytes)) === expectedHash;
      setResult({text: matches ? 'The file matches the reported SHA3-256 commitment.' :
        'The file does not match the reported SHA3-256 commitment.'});
    } catch {
      if (isCurrent()) setResult({error: true, text: 'The selected metadata file could not be checked.'});
    } finally {
      bytes?.fill(0);
    }
  }

  function clearResult() {
    sequence.current++;
    setResult(null);
    input.current.focus();
  }

  return <section aria-label="NFT metadata file check">
    <p id={instructions}>Compare a local file up to 256 KiB with this NFT’s reported SHA3-256 commitment. A match covers the exact file bytes.</p>
    <label>Choose local metadata file<input ref={input} type="file" aria-describedby={instructions} onChange={chooseFile}/></label>
    {result && <>
      <button type="button" onClick={clearResult}>Clear metadata check</button>
      <p role={result.error ? 'alert' : 'status'} className={result.error ? 'native-error' : undefined}>{result.text}</p>
    </>}
  </section>;
}
