const ARTIFACTS=Object.freeze([
 'config/node.json','config/start-authorized.json','network/genesis.json',
 'network/authority.json','network/authority-root.pub','network/network-manifest.json',
 'network/transport-registry.json','network/transport-root.pub',
]);
const pin=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

export function transportStagingView(value){
 const files=value?.artifact_sha256;
 if(value?.schema!=='nodenetwork-native-transport-staged-v1'||value.staged!==true||
    typeof value.address!=='string'||!/^synv1[a-z0-9]{20,100}$/.test(value.address)||
    !pin(value.review_sha256)||value.fleet_readiness_verified!==false||
    value.commissioned!==false||value.runtime_admission!==false||
    !files||typeof files!=='object'||Array.isArray(files)||
    Object.keys(files).length!==ARTIFACTS.length||ARTIFACTS.some(name=>!pin(files[name])))
  throw Error('Unsupported transport staging receipt. Inspect the selected controller; no commissioning or readiness is inferred.');
 return {schema:value.schema,staged:true,address:value.address,review_sha256:value.review_sha256,
  artifact_sha256:Object.fromEntries(ARTIFACTS.map(name=>[name,files[name]])),
  fleet_readiness_verified:false,commissioned:false,runtime_admission:false};
}


export function transportFailureMessage(failure){
 const message=typeof failure==='string'?failure:failure instanceof Error?failure.message:null;
 // Native commands reject with a String. Never stringify an arbitrary object,
 // render control bytes or pass through an unbounded diagnostic payload.
 return typeof message==='string'&&message.length>0&&message.length<=512&&!/[\x00-\x1f\x7f]/.test(message)
  ?message:'Transport result unavailable. Reconcile uncertain staging through the same staging action before another approval.';
}
