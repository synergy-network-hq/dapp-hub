import {R5_BASELINE} from './nodeNetwork.js';
const key='synergy-nodenetwork:provisioning-draft:v1';
const fields=['release_id','manifest_sha256','network_id','chain_id','node_name'];
export const emptyProvisioningDraft=()=>({...R5_BASELINE,network_id:'',chain_id:'99999',node_name:''});
function validate(value){
 if(!value||value.version!==1||!value.form||typeof value.form!=='object'||Array.isArray(value.form)||Object.keys(value.form).some(name=>!fields.includes(name))||!fields.every(name=>typeof value.form[name]==='string'&&value.form[name].length<=128&&!/[\u0000-\u001f\u007f]/.test(value.form[name])))throw Error('Saved provisioning draft is unsupported or unreadable; original storage retained.');
 return Object.fromEntries(fields.map(name=>[name,value.form[name]]));
}
export function readProvisioningDraft(){const raw=localStorage.getItem(key);if(raw!==null&&raw.length>16384)throw Error('Saved provisioning draft exceeds the supported size; original storage retained.');return raw===null?emptyProvisioningDraft():validate(JSON.parse(raw));}
export function saveProvisioningDraft(form){
 // Validate the existing record before replacing it. No credentials, target or approval are stored.
 readProvisioningDraft();const clean=validate({version:1,form});localStorage.setItem(key,JSON.stringify({version:1,form:clean}));return clean;
}
