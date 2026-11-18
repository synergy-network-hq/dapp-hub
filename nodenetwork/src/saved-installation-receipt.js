import {installParameters,validInstallNetworkId,validInstallNodeName} from './nodeNetwork.js';
import {exactObservationU64,parseExactNumbers} from './validator-operations-observation.js';
import {parseSoftwareInventory,readDraftPackageManifest,readUpgradeJsonFile,sameSoftwareInventory} from './saved-upgrade-intent.js';

// Testnet v3 613fa6ab: synergy_linux.py::install and lifecycle.py::_sealed_receipt.
export const savedInstallationReceiptLimit = 2 * 1024 * 1024;
const unsupported = 'The file is not a supported saved NodeNetwork installation receipt.';

export function readInstallationPackageManifest(file,form,current) {
 return readDraftPackageManifest(file,form,current,
  'The selected package manifest differs from the approved release references in the provisioning draft.');
}

export async function compareSavedInstallationReceipt(file,manifest,form,current = () => true) {
 const draft = installParameters(form);
 if (manifest?.release !== draft.release_id || manifest.pin !== draft.manifest_sha256) {
  throw Error('Select the manifest for the current provisioning draft before reviewing the receipt.');
 }
 const selected = await readUpgradeJsonFile(file,savedInstallationReceiptLimit,current);
 if (!current() || !selected) return null;
 let receipt;
 try {receipt = parseExactNumbers(selected.raw);} catch {throw Error(unsupported);}
 const chainId = exactObservationU64(receipt?.chain_id), pin = receipt?.package_sha256;
 if (receipt?.format !== 'synergy-universal-linux-v1' || typeof receipt.root !== 'string' || !receipt.root.length
  || !['validator','rpc_gateway'].includes(receipt.role) || !validInstallNetworkId(receipt.network_id)
  || chainId === null || chainId === '0' || !validInstallNodeName(receipt.node_name)
  || typeof pin !== 'string' || pin.length !== 64 || /[^0-9a-f]/.test(pin)) throw Error(unsupported);
 const files = parseSoftwareInventory(receipt.package_files,unsupported);
 return {
  rootMatches:receipt.root === '/opt/Synergy',
  validatorRole:receipt.role === 'validator',
  networkMatches:receipt.network_id === draft.network_id,
  chainMatches:chainId === String(draft.chain_id),
  nodeNameMatches:receipt.node_name === draft.node_name,
  digestMatches:pin === manifest.pin,
  inventoryMatches:sameSoftwareInventory(files,manifest.files),
  declaredMembers:Object.keys(files).length,
 };
}
