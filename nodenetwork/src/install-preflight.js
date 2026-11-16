import {installParameters, provisioningChecks, releaseReferenceChecks} from './nodeNetwork.js';
import {controllerRead} from './target-observation.js';

// The pinned controller replies with only these six fields after checking
// the staged manifest and the host's approved release and network policy.
function supportedReport(value, parameters, target) {
 return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 6
  && typeof value.release === 'string' && value.release === parameters?.release_id
  && value.root === '/opt/Synergy' && value.root === target?.root
  && value.packageVerified === true && value.networkSelectionApproved === true
  && value.genesisAuthorityVerified === false && value.activationAuthorized === false;
}

export function installPreflightObservation(value, parameters, target) {
 if (!supportedReport(value, parameters, target)) throw Error('The selected controller returned unsupported or mismatched installation preflight evidence.');
 return value;
}

export function masterDraftComparison(master,form) {
 const check = 'Inspected master comparison';
 if (!master) return {check,status:'Not inspected',detail:'Optionally inspect the master folder and compare its release and digest with the draft.'};
 const references = releaseReferenceChecks({release_id:master.release,manifest_sha256:master.manifestSha256});
 if (references.some(field=>!field.valid)) return {check,status:'Unavailable',detail:'Inspect the master folder again.'};
 if (releaseReferenceChecks(form).some(field=>!field.valid)) {
  return {check,status:'Draft references incomplete',detail:'Enter a release ID and manifest digest to compare with the inspected master.'};
 }
 const matches = master.release === form.release_id && master.manifestSha256 === form.manifest_sha256;
 return {check,status:matches?'References match':'References differ',detail:matches
  ? 'The inspected release and digest match the draft.'
  : 'The inspected release or digest differs from the current draft.'};
}

export function installPreflightChecklist({form, target, permitted, capabilities, master, attempt}) {
 const fields = provisioningChecks(form);
 const invalid = fields.filter(field => !field.valid);
 const parameters = invalid.length ? null : installParameters(form);
 const draft = {
  check: 'Required request fields',
  status: invalid.length ? 'Needs input' : 'Format accepted',
  detail: invalid.length
   ? invalid.map(field => field.message).join(' ')
   : 'Release, manifest, network, chain and node name are ready to submit for native validation.',
 };

 const packageReview = masterDraftComparison(permitted ? master : null,form);

 const capability = controllerRead(capabilities?.data, 'install_preflight');
 const capabilityAvailable = permitted && !capabilities?.loading && !capabilities?.error && capability.available;
 let access = {
  check: 'Target preflight access',
  status: 'Host selection deferred',
  detail: 'Prepare the draft here. Use target settings when you are ready to select and enroll a host.',
 };
 if (target) {
  access = {...access, status: 'Unavailable', detail: 'Inspect the enrolled target. Review its controller access and run inspection again.'};
  if (!permitted) {
   access = {...access, status: 'Permission required', detail: 'Allow NodeNetwork inspection in Security & permissions.'};
  } else if (capabilities?.loading) {
   access = {...access, status: 'Inspecting target', detail: 'Wait for controller capabilities.'};
  } else if (capabilityAvailable) {
   access = {...access, status: 'Capability reported', detail: 'The selected controller lists the installation preflight operation.'};
  } else if (capabilities?.data) {
   access = {...access, detail: capability.blocker};
  }
 }

 let receipt = {
  check: 'Installation preflight receipt',
  status: 'Not run',
  detail: 'Run preflight for the current draft on an enrolled target when its controller is available.',
 };
 let checks = [];
 if (attempt && permitted && target) {
  const current = parameters && Object.keys(parameters).every(key => parameters[key] === attempt.parameters?.[key]);
  if (!current) {
   receipt = {...receipt, status: 'Draft changed', detail: 'Run preflight again for the current release and node parameters.'};
  } else if (attempt.state === 'pending') {
   receipt = {...receipt, status: 'Waiting for controller', detail: 'A preflight request for the current draft is pending.'};
  } else if (attempt.state === 'received') {
   if (supportedReport(attempt.observation, parameters, target)) {
    receipt = {...receipt, status: 'Checks reported',
     detail: `The selected controller returned its package and policy checks at ${new Date(attempt.receivedAt).toISOString()}.`,
    };
    checks = [
     {check: 'Staged package inventory', status: 'Reported verified', detail: `The controller verified the staged manifest and inventory for ${parameters.release_id}.`},
     {check: 'Host network policy', status: 'Reported approved', detail: `The controller reported approval for ${parameters.network_id} on chain ${parameters.chain_id}.`},
     {check: 'Genesis authority', status: 'Unverified', detail: 'Verify the signed Genesis and its authority before commissioning.'},
     {check: 'Activation authorization', status: 'Not authorized', detail: 'Activation requires a separate authorized lifecycle review.'},
    ];
   } else {
    receipt = {...receipt, status: 'Unsupported report', detail: 'Run a new preflight with a compatible controller.'};
   }
  } else {
   receipt = {...receipt, status: 'Check unsuccessful', detail: 'Review the controller connection and approved package references before rerunning preflight.'};
  }
 }
 return {
  canRun: Boolean(target && capabilityAvailable && parameters),
  rows: [draft, packageReview, access, receipt, ...checks, {
   check: 'Required host checks',
   status: 'Unverified',
   detail: 'Confirm host capacity, clock, ports, enrollment and release policy through the qualified controller.',
  }],
 };
}
