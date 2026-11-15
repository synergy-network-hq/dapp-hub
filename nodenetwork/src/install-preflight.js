import {controllerOperation, installParameters, provisioningChecks} from './nodeNetwork.js';

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

 let packageReview = {
  check: 'Inspected master comparison',
  status: 'Not inspected',
  detail: 'Optionally inspect the master folder and compare its release and digest with the draft.',
 };
 if (master && permitted) {
  const references = provisioningChecks({
   release_id: master.release,
   manifest_sha256: master.manifestSha256,
  }).filter(field => field.field === 'release_id' || field.field === 'manifest_sha256');
  if (references.some(field => !field.valid)) {
   packageReview = {...packageReview, status: 'Unavailable', detail: 'Inspect the approved master folder again.'};
  } else {
   const matches = master.release === form.release_id && master.manifestSha256 === form.manifest_sha256;
   packageReview = {...packageReview,
    status: matches ? 'References match' : 'References differ',
    detail: matches
     ? 'The inspected release and digest match the draft. Check release authorization separately.'
     : 'Compare the draft with the approved release before using the inspected manifest.',
   };
  }
 }

 const capabilityAvailable = permitted && !capabilities?.loading && !capabilities?.error
  && controllerOperation(capabilities?.data, 'install_preflight').available;
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
  }
 }

 let receipt = {
  check: 'Installation preflight receipt',
  status: 'Not run',
  detail: 'Run preflight for the current draft on an enrolled target when its controller is available.',
 };
 if (attempt && permitted && target) {
  const current = parameters && Object.keys(parameters).every(key => parameters[key] === attempt.parameters?.[key]);
  if (!current) {
   receipt = {...receipt, status: 'Draft changed', detail: 'Run preflight again for the current release and node parameters.'};
  } else if (attempt.state === 'pending') {
   receipt = {...receipt, status: 'Waiting for controller', detail: 'A preflight request for the current draft is pending.'};
  } else if (attempt.state === 'received') {
   receipt = {...receipt, status: 'Response received',
    detail: `The controller returned a successful response at ${new Date(attempt.receivedAt).toISOString()}. Review the individual host checks before proceeding.`,
   };
  } else {
   receipt = {...receipt, status: 'Check unsuccessful', detail: 'Review the controller connection and approved package references before rerunning preflight.'};
  }
 }
 return {
  canRun: Boolean(target && capabilityAvailable && parameters),
  rows: [draft, packageReview, access, receipt, {
   check: 'Required host checks',
   status: 'Unverified',
   detail: 'Confirm host capacity, clock, ports, enrollment and release policy through the qualified controller.',
  }],
 };
}
