import {nodeNetworkTarget} from './nodeNetwork.js';
// Saved entries are public selections only. Native controller authentication is
// repeated at collection; this list never conveys readiness or host trust.
export function fleetTargets(value){
 if(!Array.isArray(value)||value.length>5)throw Error('Select at most five independently targeted controllers.');
 const targets=value.map(nodeNetworkTarget),keys=targets.map(t=>JSON.stringify(t));
 if(new Set(keys).size!==keys.length)throw Error('Each controller or managed guest must be selected exactly once.');
 return targets;
}
export function addFleetTarget(value,target){return fleetTargets([...fleetTargets(value),nodeNetworkTarget(target)]);}
