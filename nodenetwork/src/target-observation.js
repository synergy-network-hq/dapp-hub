import {controllerOperation} from './nodeNetwork.js';

const boundedToken = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value);
const reportedBoolean = value => typeof value === 'boolean' ? value : 'Not reported';

export function targetControllerObservation(value, receivedAt = Date.now()) {
 if (!value || typeof value !== 'object' || Array.isArray(value) || value.root !== '/opt/Synergy') {
  throw Error('Target controller metadata is missing or names an unsupported installation root.');
 }
 const version = value.controllerVersion;
 const controllerVersion = boundedToken(version) || (Number.isSafeInteger(version) && version >= 0)
  ? version : 'Not reported';
 const operations = Array.isArray(value.operations) && value.operations.length <= 100 ? value.operations : [];
 return {
  receivedAt,
  operations,
  summary: {
   installationRoot: value.root,
   reportedPlatform: boundedToken(value.platform) ? value.platform : 'Not reported',
   reportedArchitecture: boundedToken(value.architecture) ? value.architecture : 'Not reported',
   controllerVersion,
   controllerReportedInstalled: reportedBoolean(value.installed),
   controllerReportedLocalSupport: reportedBoolean(value.localValidatorSupported),
   controllerReportedCommunityEnrollment: reportedBoolean(value.communityEnrollment),
  },
 };
}
export function controllerRead(controller, operation) {
 const capability = controllerOperation(controller, operation);
 if (!capability.available) return capability;
 if (controller.summary?.controllerVersion !== 1 || controller.operations.find(row => row?.operation === operation)?.kind !== 'read') {
  return {available: false, blocker: 'The selected controller did not advertise a supported read.'};
 }
 return capability;
}

export function installedControllerRead(controller, operation) {
 const capability = controllerRead(controller, operation);
 if (capability.available && controller.summary.controllerReportedInstalled !== true) {
  return {available: false, blocker: 'A controller-reported node installation is required for this inspection.'};
 }
 return capability;
}

function controllerMutation(controller, operation, installed) {
 const capability = controllerOperation(controller,operation);
 if (!capability.available) return capability;
 const {summary} = controller;
 if (summary?.controllerVersion !== 1 || summary.controllerReportedInstalled !== installed
  || summary.reportedPlatform !== 'linux' || summary.reportedArchitecture !== 'x86_64' || summary.controllerReportedLocalSupport !== true
  || controller.operations.find(row=>row?.operation===operation)?.kind !== 'mutation') {
  const message = installed ? 'An installed Linux x86-64 controller must advertise this exact action.'
   : 'An uninstalled Linux x86-64 controller must advertise this exact action.';
  return {available:false,blocker:message};
 }
 return capability;
}

export function installedControllerMutation(controller, operation) {
 return controllerMutation(controller, operation, true);
}

export function stagedInstallMutation(controller) {
 return controllerMutation(controller, 'install', false);
}
