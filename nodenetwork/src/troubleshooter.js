export const symptoms = [
 {id: 'rpc', label: 'Public network unavailable'},
 {id: 'sync', label: 'Synchronization status unclear'},
 {id: 'local', label: 'Local validator prerequisites'},
 {id: 'target', label: 'Target controls unavailable'},
];

const priority = {'Needs attention': 0, Unavailable: 1, Pending: 2, Observed: 3};

function observationTime(value) {
 return Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000
  ? new Date(value).toISOString()
  : null;
}

function publicFindings(symptom, profile, live) {
 const label = 'Public RPC chain status';
 const next = 'Review the observation network selection, then rerun the public read.';
 if (live.loading) return [{label, status: 'Pending', evidence: 'Waiting for the public RPC.', next}];
 const chain = live.data?.chain;
 const expected = Number(profile.chainId);
 if (live.error || !Number.isSafeInteger(expected) || expected <= 0 || chain?.chain_id !== expected) {
  return [{label, status: 'Unavailable', evidence: 'A response matching the selected chain is unavailable.', next}];
 }
 const ready = chain.ready;
 const findings = [{
  label,
  status: ready === false ? 'Needs attention' : 'Observed',
  evidence: ready === false ? 'The RPC reports that it is not ready.'
   : ready === true ? 'The RPC reports ready for the selected chain ID.'
    : 'The RPC returned the selected chain ID. Readiness was not reported.',
  next: ready === false ? 'Rerun the check. If the result persists, share the summary with the endpoint operator.' : 'Check Overview for the current public observations.',
  receivedAt: observationTime(live.data.chainReceivedAt),
 }];
 if (symptom === 'sync') {
  const sync = live.data.observations?.sync;
  const receivedAt = observationTime(live.data.receivedAt?.sync);
  const observed = !live.data.errors?.sync && Boolean(sync && typeof sync === 'object' && !Array.isArray(sync) && receivedAt);
  findings.push({
   label: 'Public RPC sync status',
   status: observed ? 'Observed' : 'Unavailable',
   evidence: observed ? 'The selected public RPC returned a sync status object.' : 'There is no usable current public sync observation.',
   next: observed ? 'Review synchronization in Overview. Measuring a managed validator requires its authenticated telemetry.' : 'Rerun the public read. Escalate repeated sync-source failures to the endpoint operator.',
   receivedAt: observed ? receivedAt : null,
  });
 }
 return findings;
}

function localFindings(local) {
 const label = 'Local native runtime metadata';
 const next = 'Rerun the local check from native Portal when the runtime is available.';
 if (local.loading) return [{label, status: 'Pending', evidence: 'Waiting for the local runtime inspection.', next}];
 const data = local.data;
 if (local.error || data?.qualification !== 'not-verified' || data.controlAvailable !== false
  || typeof data.localValidatorSupported !== 'boolean') {
  return [{label, status: 'Unavailable', evidence: 'A supported local runtime response is unavailable.', next}];
 }
 if (!data.localValidatorSupported) return [{
  label, status: 'Needs attention', evidence: 'The local runtime reports that this machine is outside the current Linux x86_64 validator package support.',
  next: 'Use public monitoring here. Review managed Linux requirements with the node operator when ready.',
 }];
 return [{
  label, status: 'Observed',
  evidence: data.installed === true ? 'The local inspector found installation metadata.' : 'The local runtime reports platform compatibility.',
  next: 'Review required host checks in Operations before planning installation.',
 }];
}

export function troubleshoot({symptom, permitted, profile, local, live, hasTarget, targetSettingsReadable}) {
 if (!permitted) return [{
  label: 'NodeNetwork inspection', status: 'Unavailable',
  evidence: 'Inspection permission is disabled.',
  next: 'Review NodeNetwork read access in Security & permissions.',
 }];
 if (symptom === 'local') return localFindings(local);
 if (symptom === 'target') return [{
  label: 'Portal target settings',
  status: !targetSettingsReadable ? 'Needs attention' : hasTarget ? 'Observed' : 'Unavailable',
  evidence: !targetSettingsReadable ? 'The saved choice needs review.'
   : hasTarget ? 'A managed target is configured locally.' : 'Host selection is deferred.',
  next: hasTarget ? 'Open Monitoring when ready to inspect the selected controller.' : 'Review Target settings and use public monitoring while host selection is deferred.',
 }];
 if (symptom === 'rpc' || symptom === 'sync') {
  return publicFindings(symptom, profile, live).sort((a, b) => priority[a.status] - priority[b.status]);
 }
 return [];
}

export function reviewTroubleshooting(input, now = Date.now()) {
 const chainId = Number(input.profile.chainId);
 return {
  schema: 'nodenetwork-diagnostics-v1',
  scope: 'Portal and selected public RPC observations',
  symptom: symptoms.some(item => item.id === input.symptom) ? input.symptom : null,
  chainId: Number.isSafeInteger(chainId) && chainId > 0 ? chainId : null,
  reviewedAt: observationTime(now),
  findings: troubleshoot(input),
 };
}
