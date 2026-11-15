const fields = [
 'service_registered', 'enrollment_staged', 'enrollment_recorded', 'reconciliation_required', 'server_bound', 'connected',
];

export function vpnStatusObservation(value) {
 if (value?.schema !== 'nodenetwork-vpn-status-v1' || fields.some(field => typeof value[field] !== 'boolean')) {
  throw Error('The selected controller returned unsupported VPN status.');
 }
 return Object.fromEntries(fields.map(field => [field, value[field]]));
}
