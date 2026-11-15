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
