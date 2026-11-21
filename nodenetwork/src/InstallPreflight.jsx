import {Card, Table} from '@synergy-network/portal-native/dapp-sdk';

const columns = [
 {key: 'check', label: 'Check'},
 {key: 'status', label: 'Status'},
 {key: 'detail', label: 'Evidence and next step'},
];

export function InstallPreflight({checklist, action}) {
 return <Card title="Installation preflight" action={action}>
  <Table rows={checklist.rows} columns={columns}/>
 </Card>;
}
