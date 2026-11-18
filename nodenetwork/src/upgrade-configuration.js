import {localSha256} from './local-sha256.js';
import {readDraftPackageManifest,readUpgradeJsonFile} from './saved-upgrade-intent.js';
import {exactJsonNumber,parseExactNumbers} from './validator-operations-observation.js';

// Testnet v3 613fa6ab: configuration_schema.py and conformance.py::validate_schema.
const schemaMember = 'assets/node-config.schema.json';
const schemaLimit = 128 * 1024;
const configLimit = 128 * 1024;
const schemaError = 'The manifest-bound schema is outside the supported Synergy NodeConfiguration format.';
const configError = 'The selected configuration is not unambiguous JSON within the review limits.';
const kinds = new Set(['object','array','string','integer','boolean']);
const schemaMetadata = {'$schema':'https://json-schema.org/draft/2020-12/schema',
 '$id':'https://schemas.synergy.network/node-config/v1',title:'Canonical native NodeConfiguration'};
const rootRequired = ['schema_version','node_name','role','chain_id','network_id','manifest_path',
 'public_identity_path','admin_socket_path','storage'];
const object = value=>value && typeof value==='object' && !Array.isArray(value);
const integer = value=>/^-?(0|[1-9][0-9]*)$/.test(exactJsonNumber(value));
const integerValue = value=>exactJsonNumber(value)==='-0' ? '0' : exactJsonNumber(value);

function parsed(raw,message) {
 try {return parseExactNumbers(raw);} catch {throw Error(message);}
}

function checkSchema(node,root = false) {
 if (!object(node)) throw Error(schemaError);
 const {type,properties,items,required,additionalProperties} = node;
 const nullable = Array.isArray(type);
 const base = nullable ? type[0] : type;
 if (!kinds.has(base) || (nullable && (type.length !== 2 || type[1] !== 'null'))) throw Error(schemaError);
 const fields = new Set(['type']);
 if (root) Object.keys(schemaMetadata).forEach(name=>fields.add(name));
 if (base === 'object') {
  if (!object(properties) || additionalProperties !== false) throw Error(schemaError);
  fields.add('properties');fields.add('additionalProperties');
  if (Object.hasOwn(node,'required')) {
   if (!Array.isArray(required) || new Set(required).size !== required.length
    || !required.every(name=>typeof name==='string' && Object.hasOwn(properties,name))) throw Error(schemaError);
   fields.add('required');
  }
  Object.values(properties).forEach(child=>checkSchema(child));
 } else if (base === 'array') {
  fields.add('items');
  checkSchema(items);
 }
 if (Object.hasOwn(node,'const')) {
  if (base !== 'integer' || !integer(node.const)) throw Error(schemaError);
  fields.add('const');
 }
 if (Object.keys(node).some(name=>!fields.has(name))) throw Error(schemaError);
}

function configurationSchema(raw) {
 const schema = parsed(raw,schemaError);
 if (!object(schema) || schema.type !== 'object'
  || !Object.entries(schemaMetadata).every(([key,value])=>schema[key]===value)
  || !Array.isArray(schema.required) || schema.required.length !== rootRequired.length
  || !rootRequired.every(name=>schema.required.includes(name))
  || schema.properties?.schema_version?.type !== 'integer'
  || exactJsonNumber(schema.properties.schema_version.const) !== '1') throw Error(schemaError);
 checkSchema(schema,true);
 return schema;
}

function kind(value) {
 if (value === null) return 'null';
 if (Array.isArray(value)) return 'array';
 const wire = exactJsonNumber(value);
 if (wire) return integer(value) ? 'integer' : 'number';
 return typeof value;
}

function firstSchemaFinding(value,schema) {
 const actual = kind(value);
 const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
 if (!allowed.includes(actual)) return 'type';
 if (value === null) return null;
 if (Object.hasOwn(schema,'const') && integerValue(value) !== integerValue(schema.const)) return 'constant';
 if (actual === 'object') {
  if (schema.required?.some(name=>!Object.hasOwn(value,name))) return 'missing';
  if (Object.keys(value).some(name=>!Object.hasOwn(schema.properties,name))) return 'extra';
  for (const [name,child] of Object.entries(value)) {
   const finding = firstSchemaFinding(child,schema.properties[name]);
   if (finding) return finding;
  }
 }
 if (actual === 'array') {
  for (const child of value) {
   const finding = firstSchemaFinding(child,schema.items);
   if (finding) return finding;
  }
 }
 return null;
}

export async function readUpgradeConfigurationManifest(file,references,current = () => true) {
 const candidate = await readDraftPackageManifest(file,references,current);
 if (!current() || !candidate) return null;
 if (!Object.hasOwn(candidate.files,schemaMember)) throw Error('The selected candidate manifest does not declare the NodeConfiguration schema asset.');
 return {schemaPin:candidate.files[schemaMember]};
}

export async function readUpgradeConfigurationSchema(file,manifest,current = () => true) {
 const selected = await readUpgradeJsonFile(file,schemaLimit,current);
 if (!current() || !selected) return null;
 const pin = await localSha256(selected.bytes);
 if (!current()) return null;
 if (pin !== manifest.schemaPin) throw Error('The selected schema SHA-256 differs from the candidate manifest.');
 return configurationSchema(selected.raw);
}

export async function reviewUpgradeConfiguration(file,schema,current = () => true) {
 const selected = await readUpgradeJsonFile(file,configLimit,current);
 if (!current() || !selected) return null;
 const configuration = parsed(selected.raw,configError);
 const finding = firstSchemaFinding(configuration,schema);
 return {status:finding ?? 'matched'};
}
