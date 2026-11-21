const key='synergy-nodenetwork:provisioning-draft:v1';
const fields=['release_id','manifest_sha256','network_id','chain_id','node_name'];
export const emptyProvisioningDraft=()=>({release_id:'',manifest_sha256:'',network_id:'',chain_id:'',node_name:''});
function validate(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(name=>!['version','form'].includes(name))||value.version!==1||!value.form||typeof value.form!=='object'||Array.isArray(value.form)||Object.keys(value.form).some(name=>!fields.includes(name))||!fields.every(name=>typeof value.form[name]==='string'&&value.form[name].length<=128&&!/[\u0000-\u001f\u007f]/.test(value.form[name])))throw Error('Saved provisioning draft is unsupported or unreadable; original storage retained.');
 return Object.fromEntries(fields.map(name=>[name,value.form[name]]));
}
export function readProvisioningSnapshot(){
 const raw=localStorage.getItem(key);
 if(raw!==null&&raw.length>16384)throw Error('Saved provisioning draft exceeds the supported size; original storage retained.');
 return {raw,form:raw===null?emptyProvisioningDraft():validate(JSON.parse(raw))};
}
export function readProvisioningDraft(){return readProvisioningSnapshot().form;}
export function saveProvisioningDraft(form,expectedRaw){
 // Optimistic conflict check, not an atomic cross-window transaction.
 const current=readProvisioningSnapshot();
 if(expectedRaw===undefined||current.raw!==expectedRaw)throw Error('The saved provisioning draft changed. Your edits are retained. Review the saved copy before replacing your draft.');
 const clean=validate({version:1,form}),raw=JSON.stringify({version:1,form:clean});
 localStorage.setItem(key,raw);return {form:clean,raw};
}
