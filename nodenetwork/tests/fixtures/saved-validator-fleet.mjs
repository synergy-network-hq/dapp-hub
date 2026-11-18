import {readFileSync} from 'node:fs';
import {URL as NodeURL} from 'node:url';

const source = readFileSync(new NodeURL('./validator-operations-observation.json',import.meta.url),'utf8')
 .replaceAll('18446744073709551615','101').replaceAll('18446744073709551614','100')
 .replaceAll('9007199254740993','9');

export function savedValidatorFleetFixture() {
 const {observed_at_utc:generated_at_utc,...base} = JSON.parse(source);
 const validators = ['operator-validator-a','operator-validator-b'].map(validator_id => ({...structuredClone(base),generated_at_utc,
  discovery:{...base.discovery,validator_id}, release_consistency:{matches_expected:true,mismatch_fields:[]},
  health:{classification:'HEALTHY',reasons:['excluded operator reason']}, liveness:{health:'HEALTHY',height:101,finalized_height:100},
 }));
 return {schema_version:base.schema_version,generated_at_utc,validators,unavailable_validator_ids:[],
  release_consistency:{consistent:true,reference_validator_id:validators[0].discovery.validator_id,
   mismatched_validator_ids:[],mismatched_fields_by_validator:{}},common_head_height:101,common_finalized_height:100,
  quorum_available:true,divergence_detected:false};
}
