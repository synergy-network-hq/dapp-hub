import {useEffect, useRef, useState} from 'react';

const empty = {result: null, error: '', reading: false};

export function useObservationFile(readFile, {maxFiles = 1} = {}) {
 const [state, setState] = useState(empty);
 const revision = useRef(0);
 useEffect(() => () => {revision.current++;}, []);

 function clear() {
  revision.current++;
  setState(empty);
 }

 async function select(event) {
  const files = event.target.files;
  const selection = maxFiles === 1 ? files?.[0] : Array.prototype.slice.call(files ?? [], 0, maxFiles + 1);
  event.target.value = '';
  if (!selection || (Array.isArray(selection) && !selection.length)) return;
  const request = ++revision.current;
  setState({...empty, reading: true});
  try {
   const result = await readFile(selection, () => revision.current === request);
   if (revision.current === request) setState({...empty, result, revision:request});
  } catch (failure) {
   if (revision.current === request) setState({...empty, error: failure.message});
  }
 }

 return {...state, clear, select};
}
