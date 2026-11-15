const fields = [
 'service_registered', 'enrollment_staged', 'enrollment_recorded', 'reconciliation_required', 'server_bound', 'connected',
];

export function vpnStatusObservation(value) {
 if (value?.schema !== 'nodenetwork-vpn-status-v1' || fields.some(field => typeof value[field] !== 'boolean')) {
  throw Error('The selected controller returned unsupported VPN status.');
 }
 const {enrollment_recorded:recorded, reconciliation_required:reconciliation, server_bound:bound, connected, service_registered:registered} = value;
 if ((recorded && reconciliation) || (!recorded && (bound || connected)) || (connected && !registered)) {
  throw Error('The selected controller returned unsupported VPN status.');
 }
 return Object.fromEntries(fields.map(field => [field, value[field]]));
}

export function vpnPrerequisiteStatus(observation) {
 if (observation.reconciliation_required) return 'Ask the VPN operator to reconcile the prior attempt before pursuing enrollment.';
 if (!observation.service_registered) return 'Review registration of the contained VPN service before enrollment or validator startup.';
 if (!observation.enrollment_recorded) {
  return observation.enrollment_staged
   ? 'The enrollment input is staged. Fresh enrollment requires qualified transport and an exact one-use host grant.'
   : 'Ask the VPN operator to stage an approved one-use enrollment input and arrange the matching host grant.';
 }
 if (!observation.server_bound) return 'Ask the VPN operator to verify the recorded validator peer against the server binding.';
 if (!observation.connected) return 'Use Logs & Diagnostics to investigate connectivity for the bound validator peer.';
 return 'The controller reports that the VPN prerequisites for validator start and restart are met.';
}
