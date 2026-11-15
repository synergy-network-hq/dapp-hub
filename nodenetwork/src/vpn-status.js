import {controllerOperation} from './nodeNetwork.js';

const fields = [
 'service_registered', 'enrollment_staged', 'enrollment_recorded', 'reconciliation_required', 'server_bound', 'connected',
];

export function vpnStatusGate(controller) {
 const operation = controllerOperation(controller, 'vpn_status');
 if (!operation.available) return operation;
 if (controller.summary?.controllerVersion !== 1 || controller.operations.find(row => row?.operation === 'vpn_status')?.kind !== 'read') {
  return {available: false, blocker: 'The selected controller did not advertise a supported VPN status read.'};
 }
 if (controller.summary.controllerReportedInstalled !== true) {
  return {available: false, blocker: 'A controller-reported node installation is required for VPN inspection.'};
 }
 return operation;
}

export function vpnStatusObservation(value) {
 if (value?.schema !== 'nodenetwork-vpn-status-v1' || fields.some(field => typeof value[field] !== 'boolean')) {
  throw Error('The selected controller returned unsupported VPN status.');
 }
 return Object.fromEntries(fields.map(field => [field, value[field]]));
}
