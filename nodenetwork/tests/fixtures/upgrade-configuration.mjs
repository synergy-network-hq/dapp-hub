import {createHash} from 'node:crypto';

export const configurationDigest = bytes=>createHash('sha256').update(bytes).digest('hex');
const schemaMember = 'assets/node-config.schema.json';
const required = ['schema_version','node_name','role','chain_id','network_id','manifest_path',
 'public_identity_path','admin_socket_path','storage'];
const text = {type:'string'};

export function upgradeSchemaFixture() {
 return {'$schema':'https://json-schema.org/draft/2020-12/schema','$id':'https://schemas.synergy.network/node-config/v1',
  title:'Canonical native NodeConfiguration',type:'object',additionalProperties:false,required:[...required],
  properties:{schema_version:{type:'integer',const:1},node_name:text,role:text,chain_id:{type:'integer'},network_id:text,
   manifest_path:text,public_identity_path:text,admin_socket_path:text,storage:{type:'object',additionalProperties:false,
    properties:{data_directory:text,minimum_free_bytes:{type:'integer'},prune_finalized_history_after_blocks:{type:['integer','null']}}},
   network:{type:'object',additionalProperties:false,properties:{listen_addresses:{type:'array',items:text}}}}};
}

export function nodeConfigurationFixture() {
 return {schema_version:1,node_name:'fixture-private-node',role:'validator',chain_id:1266,network_id:'fixture-private-incarnation',
  manifest_path:'/fixture/private/manifest',public_identity_path:'/fixture/private/identity',admin_socket_path:'/fixture/private/socket',
  storage:{data_directory:'/fixture/private/storage',minimum_free_bytes:0,prune_finalized_history_after_blocks:null},
  network:{listen_addresses:['192.0.2.10:9000']}};
}

export function upgradeManifestFixture(schema,files = {[schemaMember]:configurationDigest(schema)}) {
 const release = 'candidate-config-fixture';
 const manifest = JSON.stringify({format:'synergy-universal-linux-v1',architecture:'x86_64',release_id:release,files})+'\n';
 return {manifest,references:{release_id:release,manifest_sha256:configurationDigest(manifest)}};
}
