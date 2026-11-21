export async function digest(value){const bytes=new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value));return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export function launchPlan(input){
 const name=String(input.name||'').trim(),symbol=String(input.symbol||'').trim(),summary=String(input.summary||'').trim(),supply=String(input.supply||''),raise=String(input.raise||''),lock=Number(input.lock);
 if(name.length<3||name.length>80||!/[A-Za-z]/.test(name)||!/^[A-Z][A-Z0-9]{1,7}$/.test(symbol)||summary.length<24||summary.length>4000)throw Error('Enter a name, 2–8 character uppercase symbol and a summary of 24–4000 characters.');
 if(!/^[1-9]\d{0,29}$/.test(supply)||!/^\d{1,20}(\.\d{1,9})?$/.test(raise)||!Number.isInteger(lock)||lock<30||lock>3650)throw Error('Supply must be a positive integer, raise goal must have up to 9 SNRG decimals, and lock must be 30–3650 days.');
 const [whole,fraction='']=raise.split('.');const raiseNwei=(BigInt(whole)*1000000000n+BigInt(fraction.padEnd(9,'0'))).toString();if(raiseNwei==='0')throw Error('Raise goal must be positive.');
 return {schemaVersion:1,kind:'spark-launch-plan',chainId:1266,name,symbol,summary,totalSupply:supply,raiseGoalNwei:raiseNwei,liquidityLockDays:lock,status:'draft',execution:{factory:null,transaction:null,attestation:null}};
}

export function tokenConstructor(plan,decimals,governancePublicKey){
 if(plan?.kind!=='spark-launch-plan'||plan.chainId!==1266||typeof plan.name!=='string'||plan.name.length<3||plan.name.length>80||typeof plan.symbol!=='string'||!/^[A-Z][A-Z0-9]{1,7}$/.test(plan.symbol)||typeof plan.totalSupply!=='string'||!/^[1-9]\d{0,29}$/.test(plan.totalSupply))throw Error('Select a valid chain-1266 launch plan.');
 if(!Number.isInteger(decimals)||decimals<0||decimals>18)throw Error('Local token decimals must be an integer from 0 to 18.');
 const supply=BigInt(plan.totalSupply)*10n**BigInt(decimals);if(supply>(1n<<128n)-1n)throw Error('Raw token supply exceeds this local runtime’s 128-bit value limit.');
 const key=String(governancePublicKey||'').trim().replace(/^0x/i,'');if(key.length!==5184||!/^[a-f0-9]+$/i.test(key))throw Error('Enter a 2592-byte ML-DSA-87 public key in hex. Private keys and seed phrases are not accepted.');
 return {arguments:[plan.name,plan.symbol,decimals,supply.toString(),'0x'+key.toLowerCase()],wholeTokenSupply:plan.totalSupply,rawTokenSupply:supply.toString(),decimals,governanceKeyCheck:'shape-only',raiseGoalEnforced:false,liquidityLockEnforced:false,networkSubmitted:false};
}
