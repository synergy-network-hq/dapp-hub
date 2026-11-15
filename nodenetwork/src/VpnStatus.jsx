import {Card, Table} from '@synergy-network/portal-native/dapp-sdk';

const columns = [{key: 'check', label: 'Check'}, {key: 'status', label: 'Reported state'}];

export function VpnStatus({action, observation, receipt, onOpenDiagnostics}) {
 return <Card title="Validator VPN status" action={action}>
  {!action && <p>Host selection is deferred. A supported enrolled controller can report validator VPN status.</p>}
  <p>Service registration, enrollment, server binding and current connectivity are separate observations.</p>
  {receipt}
  {observation && <>
   <Table rows={[
    {check: 'Validator VPN service', status: observation.service_registered ? 'Registered' : 'Unregistered'},
    {check: 'Enrollment request', status: observation.enrollment_staged ? 'Staged' : 'Unstaged'},
    {check: 'Local enrollment', status: observation.enrollment_recorded ? 'Recorded' : 'Unrecorded'},
    {check: 'Server binding', status: observation.server_bound ? 'Verified by the controller' : 'Unverified'},
    {check: 'VPN connectivity', status: observation.connected ? 'Connected' : 'Unconfirmed'},
    {check: 'Prior enrollment attempt', status: observation.reconciliation_required ? 'Reconciliation required' : 'No reconciliation requirement reported'},
   ]} columns={columns}/>
   {observation.reconciliation_required && <p>Ask the VPN operator to reconcile the prior attempt before pursuing enrollment.</p>}
  </>}
  {onOpenDiagnostics && <button onClick={onOpenDiagnostics}>Open Logs &amp; Diagnostics</button>}
 </Card>;
}
