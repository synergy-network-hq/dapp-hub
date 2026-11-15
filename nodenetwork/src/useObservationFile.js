import {useEffect, useRef, useState} from 'react';

const empty = {result: null, error: '', reading: false};

export function useObservationFile(readFile) {
 const [state, setState] = useState(empty);
 const revision = useRef(0);
 useEffect(() => () => {revision.current++;}, []);

 function clear() {
  revision.current++;
  setState(empty);
 }

 async function select(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  const request = ++revision.current;
  setState({...empty, reading: true});
  try {
   const result = await readFile(file);
   if (revision.current === request) setState({...empty, result});
  } catch (failure) {
   if (revision.current === request) setState({...empty, error: failure.message});
  }
 }

 return {...state, clear, select};
}
