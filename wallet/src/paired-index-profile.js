// Portal's Atlas adapter is fixed to the public Testnet v3 index. An editable
// RPC with the same chain number cannot establish that index's network scope.
const TESTNET_V3_RPC = 'https://testnet-core-rpc.synergy-network.io/';

export function matchesPairedIndexProfile(connection, endpoint) {
  if (connection?.chainId !== 'synergy:1266' || endpoint?.chainId !== 1266 || typeof endpoint.rpc !== 'string') return false;
  try {
    return new URL(endpoint.rpc).href === TESTNET_V3_RPC;
  } catch {
    return false;
  }
}
