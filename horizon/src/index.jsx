import {useEffect, useId, useRef, useState} from 'react';
import {HorizonArtifactError, inspectHorizonFile} from './artifact.js';
import {GlassPanel, StatusPill} from './Ui.jsx';
import './horizon.css';

function Report({inspection}) {
  return (
    <>
      <div role="status"><StatusPill tone="cyan">Content matches its digest</StatusPill></div>
      <dl className="integrity-details">
        <div><dt>Model label</dt><dd><bdi>{inspection.model}</bdi></dd></div>
        <div><dt>Output characters</dt><dd>{inspection.outputCharacters}</dd></div>
        <div><dt>Content SHA-256</dt><dd><code>{inspection.sha256}</code></dd></div>
      </dl>
      {inspection.replay && (
        <section>
          <h3>Recorded replay</h3>
          <p>The replay summary agrees with the records in this file.</p>
          <dl className="integrity-details">
            <div><dt>Exact output</dt><dd>{inspection.replay.exactOutputMatch ? 'Matches' : 'Differs'}</dd></div>
            <div><dt>Same model, prompt and runtime</dt><dd>{inspection.replay.sameModelPromptAndRuntime ? 'Matched' : 'Unconfirmed'}</dd></div>
            <div><dt>Same reported model digest</dt><dd>{inspection.replay.sameReportedModelDigest ? 'Matched' : 'Unconfirmed'}</dd></div>
          </dl>
        </section>
      )}
      {inspection.receiptFieldPresent && <p>The file includes a receipt field. Device signature verification is unavailable here.</p>}
    </>
  );
}

export function HorizonApp() {
  const [inspection, setInspection] = useState({status: 'idle'});
  const input = useRef(null);
  const active = useRef(null);
  const guidance = useId();

  useEffect(() => () => active.current?.abort(), []);

  async function chooseFile(event) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setInspection({status: 'reading'});
    try {
      const data = await inspectHorizonFile(file, controller.signal);
      if (!controller.signal.aborted) setInspection({status: 'checked', data});
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof HorizonArtifactError ? error.message : 'This run artifact could not be checked.';
        setInspection({status: 'failed', message});
      }
    } finally {
      if (active.current === controller) active.current = null;
    }
  }

  function clearFile() {
    active.current?.abort();
    input.current.value = '';
    input.current.focus();
    setInspection({status: 'idle'});
  }

  return (
    <div className="horizon-inspector">
      <header className="page-header">
        <h1>Horizon</h1>
        <p>Inspect a saved run from the local AI workbench.</p>
      </header>
      <div className="workbench-grid">
        <GlassPanel className="config-panel">
          <h2>Inspect an exported run</h2>
          <p id={guidance}>Choose a Horizon run JSON file up to 2 MB. The file stays on this device.</p>
          <label className="floating-field">
            <span>Horizon run JSON</span>
            <input ref={input} type="file" accept=".json,application/json" aria-describedby={guidance} onChange={chooseFile} />
          </label>
          {inspection.status !== 'idle' && (
            <button type="button" className="horizon-clear" onClick={clearFile}>
              {inspection.status === 'reading' ? 'Cancel inspection' : 'Clear file'}
            </button>
          )}
        </GlassPanel>
        <GlassPanel className="task-runner">
          <h2>Run integrity</h2>
          {inspection.status === 'idle' && <p>Choose a file to check its recorded digest and any replay summary.</p>}
          {inspection.status === 'reading' && <p role="status">Checking run artifact…</p>}
          {inspection.status === 'failed' && <p role="alert" className="inspection-error">{inspection.message}</p>}
          {inspection.status === 'checked' && <Report inspection={inspection.data} />}
          <p>Anyone can edit a run and recompute its digest. This check cannot establish who produced the run, whether its output is correct, or whether the network verified it.</p>
        </GlassPanel>
      </div>
    </div>
  );
}
