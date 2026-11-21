// All values here are explicitly public RPC observations. A target selection
// cannot establish managed health, custody, eligibility, or proof verification.
export function workspaceOverviewState({observation,permitted,target}){
 const present=permitted&&!observation.loading&&!observation.error&&observation.data;
 return {available:Boolean(present),tone:observation.error?'amber':present?'cyan':'neutral',
  label:!permitted?'Permission needed':observation.loading?'Reading public network':observation.error?'RPC unavailable':present?'Public RPC observed':'Not inspected',
  title:'Waiting for a node update',
  description:'There is no recent telemetry. The current node state needs to be checked.',
  height:present?observation.data.canaryRuntime?.finalizedHeight??null:null,
  epoch:present?observation.data.canaryRuntime?.epoch??null:null};
}
