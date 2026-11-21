import {useEffect, useRef, useState} from 'react';
import {isTauri} from '@tauri-apps/api/core';
import {ErrorMessage,Table} from '@synergy-network/portal-native/dapp-sdk';
import {genesisStageFiles,genesisStageInputsMatch} from './genesis-stage-files.js';
import {nodeNetworkReviewGenesisStageInputs} from './native-services.js';
import {BrowserGenesisStageFiles} from './BrowserGenesisStageFiles.jsx';

const columns = [
 {key: 'id', label: 'Input'}, {key: 'bytes',label:'Bytes'}, {key: 'observed', label: 'Local SHA-256'},
 {key: 'expected', label: 'Target-reported pin'}, {key: 'status', label: 'Comparison'},
];

export function GenesisStageFiles(props) {
 return isTauri()?<NativeGenesisStageFiles {...props}/>:<BrowserGenesisStageFiles permitted={props.permitted} policy={props.policy}/>;
}

function NativeGenesisStageFiles({permitted,policy,scope,onStage,busy=false,canUse=()=>permitted}) {
 const [review,setReview]=useState(null),[reading,setReading]=useState(false),[error,setError]=useState('');
 const picker=useRef({revision:0,active:false,mounted:false});
 useEffect(()=>{
  const state=picker.current;
  state.mounted=true;
  return()=>{state.mounted=false;state.revision++;};
 },[]);

 async function select() {
  const state=picker.current;
  if(!permitted||!canUse()||state.active||busy)return;
  state.active=true;
  const attempt=++state.revision;
  setReading(true);setError('');
  try {
   const selected=await nodeNetworkReviewGenesisStageInputs();
   if(state.revision===attempt&&canUse()&&selected)setReview(selected);
  } catch (failure) {
   if(state.revision===attempt&&canUse()){
    setReview(null);
    setError(String(failure?.message||failure));
   }
  } finally {
   state.active=false;
   if(state.mounted)setReading(false);
  }
 }

 const rows = genesisStageFiles.map(({name, pin},index) => {
  const measured=review?.inputs[index];
  const expected = policy?.[pin];
  let status=reading?'Reading…':'Select files for review';
  if(!reading&&measured)status=expected?(measured.sha256===expected?'Match':'Mismatch'):'No target pin reviewed';
  return {id:name,bytes:measured?.bytes,observed:measured?.sha256,expected,status};
 });
 return <details>
  <summary>Compare Genesis input files</summary>
  <p>Portal calculates each file’s SHA-256 from its exact bytes on this device. Approved pins appear after a compatible controller reports its staging policy. Matching bytes and signed Genesis verification are separate checks.</p>
  {!permitted && <p>Allow NodeNetwork inspection in Security &amp; permissions to review local inputs.</p>}
  <button disabled={!permitted||reading||busy} onClick={select}>Review public Genesis files</button>
  <ErrorMessage error={error}/>
  <Table columns={columns} rows={rows}/>
  {review&&<p>Exact staging request approval ID <code>{review.requestSha256}</code></p>}
  <button disabled={!permitted||(!review&&!reading)||busy} onClick={() => {
   picker.current.revision++;
   setReview(null);setError('');
  }}>Clear selected file results</button>
  {onStage&&<>
   <button disabled={!permitted||reading||busy||!genesisStageInputsMatch(review,scope)}
    onClick={()=>{if(canUse()&&genesisStageInputsMatch(review,scope))onStage(review);}}>Stage reviewed public files</button>
   <p>{scope?'Select the same three files again to confirm staging. The host operator authorizes the exact request approval ID.'
    :'Read formation custody status and the matching Genesis staging policy before staging.'}</p>
  </>}
 </details>;
}
