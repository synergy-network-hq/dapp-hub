import {nodeNetworkTarget} from './nodeNetwork.js';

export const removalRoot = '/opt/Synergy';

export function removalScope(target) {
 if (target?.root !== removalRoot) return null;
 try {
  const configured = nodeNetworkTarget(target);
  return {
   kind: configured.kind,
   host: configured.kind === 'remote' ? configured.host : null,
   port: configured.kind === 'remote' ? configured.port ?? 22 : null,
   root: configured.root,
  };
 } catch {
  return null;
 }
}

export function sameRemovalScope(first, second) {
 return Boolean(first && second && first.kind === second.kind && first.host === second.host
  && first.port === second.port && first.root === removalRoot && second.root === removalRoot);
}

export function uninstallParameters(scope, confirmation) {
 if (!removalScope(scope) || confirmation !== removalRoot) throw Error('Type /opt/Synergy exactly to confirm the destructive root.');
 return {confirmation};
}
