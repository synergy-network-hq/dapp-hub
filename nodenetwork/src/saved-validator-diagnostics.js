import {captureTime, exactObservationU64, projectSavedValidatorStatus} from './validator-operations-observation.js';

const healthLabels = {
 HEALTHY:'Healthy', SYNCING:'Syncing', DEGRADED:'Degraded', STALLED:'Stalled',
 OFFLINE:'Offline', MISCONFIGURED:'Misconfigured', RELEASE_MISMATCH:'Release mismatch',
};
const unsupported = 'The saved diagnostic snapshot status and preflight could not be reconciled.';

function releaseDifferences({release, release_consistency:comparison}) {
 const {matches_expected:matches, mismatch_fields:fields} = comparison ?? {};
 if (typeof matches !== 'boolean' || !Array.isArray(fields) || matches !== (fields.length === 0)
  || fields.length > Object.keys(release).length) throw Error(unsupported);
 const found = new Set();
 for (const field of fields) {
  const {field:name, expected, actual} = field ?? {};
  if (typeof name !== 'string' || !Object.hasOwn(release,name) || found.has(name)
   || typeof expected !== 'string' || actual !== release[name] || expected === actual) throw Error(unsupported);
  found.add(name);
 }
 return [...found];
}

function hostBlockers(status, preflight, savedPreflight, releaseFields) {
 const rows = savedPreflight.rows;
 const required = preflight.required_check_ids;
 const blockers = preflight.blocking_check_ids;
 const checks = preflight.checks;
 if (preflight.generated_at_utc !== status.generated_at_utc || typeof preflight.ready !== 'boolean'
  || !Array.isArray(required) || required.length !== rows.length || new Set(required).size !== rows.length
  || !rows.every(row => required.includes(row.id)) || !Array.isArray(blockers)
  || !Array.isArray(checks) || checks.length !== status.preflight.length
  || !checks.every((row,index) => {
   const source = status.preflight[index];
   return row?.id === source.id && row.status === source.status && row.detail === source.detail;
  })) throw Error(unsupported);
 const blocked = rows.filter(row => row.status !== 'Reported pass');
 const expected = blocked.map(row => row.id);
 if (releaseFields.length) expected.push('release_consistency');
 if (preflight.ready !== (expected.length === 0) || blockers.length !== expected.length
  || new Set(blockers).size !== expected.length || !blockers.every(id => expected.includes(id))) throw Error(unsupported);
 return blocked;
}

function expectedHealth(status, releaseFields) {
 const {service, chain, posy, peers, protected_pipeline:pipeline} = status;
 if (status.preflight.some(check => check.status === 'FAIL')) return 'MISCONFIGURED';
 if (releaseFields.length) return 'RELEASE_MISMATCH';
 if (service.state !== 'ACTIVE') return 'OFFLINE';

 const finalityAge = exactObservationU64(chain.millis_since_last_finalized);
 if (chain.divergence_detected || chain.finality_progress === 'STALLED'
  || (finalityAge !== null && BigInt(finalityAge) >= 30_000n)
  || posy.vc_status === 'REJECTED' || posy.qc_status === 'REJECTED' || pipeline.phase === 'FAILED') return 'STALLED';
 const syncGap = BigInt(exactObservationU64(chain.sync_target_height)) - BigInt(exactObservationU64(chain.head_height));
 if (syncGap > 1n) return 'SYNCING';
 const authenticated = Number(exactObservationU64(peers.authenticated_validator_peer_count));
 const quorum = Number(exactObservationU64(peers.peer_quorum_threshold));
 if (!peers.p2p_listener_ready || authenticated < quorum || !chain.quorum_available
  || ['STABLE','UNKNOWN'].includes(chain.head_progress) || chain.finality_progress === 'UNKNOWN') return 'DEGRADED';
 return 'HEALTHY';
}

// DiagnosticSnapshot v1 combines the owner's derived status and host preflight.
export function projectSavedDiagnosticSnapshot(status, preflight) {
 const healthCode = status?.health?.classification;
 if (typeof healthCode !== 'string' || !Object.hasOwn(healthLabels,healthCode)
  || !preflight || typeof status.generated_at_utc !== 'string') throw Error(unsupported);
 captureTime(status.generated_at_utc);
 const {savedPreflight, missingTransition, ...metrics} = projectSavedValidatorStatus(status);
 const liveness = status.liveness;
 const transition = liveness?.first_missing_transition;
 if (liveness?.health !== healthCode || exactObservationU64(liveness.height) !== exactObservationU64(status.posy.current_height)
  || exactObservationU64(liveness.finalized_height) !== exactObservationU64(status.posy.finalized_height)
  || (missingTransition ? transition?.from !== missingTransition.from || transition.to !== missingTransition.to
   : transition != null)) throw Error(unsupported);

 const releaseFields = releaseDifferences(status);
 if (healthCode !== expectedHealth(status,releaseFields)) throw Error(unsupported);
 const blocked = hostBlockers(status,preflight,savedPreflight,releaseFields);
 return {
  statusObservedAt:status.generated_at_utc,
  reportedHealth:healthLabels[healthCode],
  ...metrics,
  missingTransition,
  releaseFields,
  requiredChecks:savedPreflight.rows.length,
  passingChecks:savedPreflight.passCount,
  blocked,
 };
}
