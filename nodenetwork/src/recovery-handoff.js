import {captureTime} from './validator-operations-observation.js';

const transitionFollowUp = {
 SERVICE: 'Request a current attributed service status and reviewed failure evidence from the node operator.',
 P2P: 'Request authenticated peer readiness and VPN reachability evidence.',
 PROTECTED_PIPELINE: 'Request current evidence for this ProtectedPipeline transition from the protocol operator.',
 POSY: 'Request current proposal, vote and finality evidence from the protocol operator.',
};
const priority = new Map([['Reported fail',0],['Ambiguous',1],['Reported unknown',2],['Missing',3]]);

export function recoveryPreflightObservation(value) {
 if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2
  || value.qualified !== false || value.certifiedStateChanged !== false) {
  throw Error('The selected controller returned unsupported recovery preflight evidence.');
 }
 return {checkpointImportQualified:false, certifiedStateChanged:false};
}

export function reviewSavedRecovery(capture, now = Date.now()) {
 let capturedAt = null;
 try {
  captureTime(capture.observedAt);
  capturedAt = capture.observedAt;
 } catch {
  // Older files may supply a display token instead of a usable capture time.
 }
 const {releaseMismatches, missingTransition, savedPreflight, headHeight, finalizedHeight} = capture;
 const release = releaseMismatches === null ? {
  status:'Comparison unavailable', next:'Compare the running release with an independently approved release reference.',
 } : releaseMismatches.length ? {
  status:'Reported mismatch', fields:[...releaseMismatches],
  next:'Resolve the release differences with the node operator before planning recovery.',
 } : {status:'Matches included reference'};
 const transition = missingTransition ? {
  from:missingTransition.from, to:missingTransition.to, evidence:missingTransition.evidence,
  next:transitionFollowUp[missingTransition.to.split('.')[0]],
 } : null;
 const hostChecks = savedPreflight.rows.filter(row => priority.has(row.status))
  .sort((left,right) => priority.get(left.status) - priority.get(right.status))
  .map(({check,status,next}) => ({check,status,next}));
 return {
  schema:'nodenetwork-recovery-handoff-v1',
  source:'Saved Validator Operations v1 observation',
  reviewedAt:new Date(now).toISOString(),
  capturedAt,
  headHeight,
  finalizedHeight,
  release,
  firstMissingTransition:transition,
  hostChecksNeedingReview:hostChecks,
  operatorReview:'Confirm current state and the release-qualified recovery procedure before making any changes.',
 };
}
