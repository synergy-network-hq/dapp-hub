import {useEffect, useRef, useState} from 'react';
import {useNative, learn, Resource, useResource} from '@synergy-network/portal-native/dapp-sdk';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {catalogContent, lessonContent, lessonPath} from './content.js';
import {readCurriculumSnapshot} from './snapshot.js';
import './learn.css';

export function LessonBlock({block}) {
  if (block.type === 'heading') return <h2>{block.text}</h2>;
  if (block.type === 'paragraph') return <p>{block.text}</p>;
  if (block.type === 'code') return <pre className="code-block"><code>{block.code}</code></pre>;
  if (block.type === 'checklist') {
    return <ul className="check-list">{block.items.map((item, i) => <li key={i}>{item}</li>)}</ul>;
  }
  if (block.type === 'comparison-table') {
    return (
      <div className="comparison-table">
        <h3>{block.title}</h3>
        <table>
          <thead><tr>{block.columns.map((item, i) => <th key={i}>{item}</th>)}</tr></thead>
          <tbody>{block.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody>
        </table>
      </div>
    );
  }
  if (block.type === 'quiz-checkpoint') {
    return <section className="callout"><h3>Lesson checkpoint</h3><p>{block.question}</p><p>Scored assessment requires an authenticated connection.</p></section>;
  }
  if (block.type === 'source-note') {
    return <section className="callout"><h3>{block.title}</h3><p>{block.text}</p><p>{block.source}</p></section>;
  }
  if (block.type === 'concept-map') {
    return (
      <section className="callout">
        <h3>{block.title}</h3>
        <ul>{block.nodes.map((node, i) => <li key={i}>{node}</li>)}</ul>
        <ul>{block.edges.map((edge, i) => <li key={i}>{edge}</li>)}</ul>
      </section>
    );
  }
  if (block.type === 'manifest') {
    return (
      <section className="callout">
        <h3>{block.title}</h3>
        <dl>{Object.entries(block.fields).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>
      </section>
    );
  }
  return <section className="callout"><strong>{block.title}</strong><p>{block.text || 'This content block is unavailable in this reader.'}</p></section>;
}

function Lesson({value}) {
  return (
    <article className="lesson-content glass-panel">
      <h1>{value.title}</h1>
      <p>{value.subtitle}</p>
      {value.content.map((block, i) => <LessonBlock block={block} key={i} />)}
    </article>
  );
}

function Catalog({value, search, setSearch, openLesson, empty}) {
  const query = search.toLowerCase();
  const paths = value.paths.filter(path => path.title.toLowerCase().includes(query));
  const lessons = value.lessons.filter(lesson => lesson.title.toLowerCase().includes(query));
  const isEmpty = value.paths.length === 0 && value.lessons.length === 0;
  return (
    <>
      <label>Search catalog<input maxLength={160} value={search} onChange={event => setSearch(event.target.value)} /></label>
      <h2>Learning paths</h2>
      <div className="card-grid">
        {paths.map(path => (
          <article className="path-card glass-panel" key={path.slug}>
            <h3>{path.title}</h3><p>{path.description}</p>
            <div className="chip-row">
              <span>{path.difficulty || 'Difficulty not reported'}</span>
              <span>{path.estimatedMinutes == null ? 'Duration not reported' : path.estimatedMinutes + ' min'}</span>
            </div>
          </article>
        ))}
      </div>
      <h2>Lessons</h2>
      {lessons.map(lesson => (
        <article className="module-row glass-panel" key={lesson.slug}>
          <h3>{lesson.title}</h3><p>{lesson.subtitle}</p>
          <button onClick={() => openLesson(lesson.slug)} aria-label={'Read lesson ' + lesson.title}>Read lesson</button>
        </article>
      ))}
      {isEmpty && <p>{empty}</p>}
      {!isEmpty && !paths.length && !lessons.length && <p>No catalog entries match your search.</p>}
    </>
  );
}

function LiveReader() {
  const [slug, setSlug] = useState('');
  const [search, setSearch] = useState('');
  const resource = useResource(async signal => {
    const value = await learn(slug ? lessonPath(slug) : 'catalog', {signal});
    return {value: slug ? lessonContent(value, slug) : catalogContent(value), receivedAt: Date.now()};
  }, slug);

  return (
    <>
      <p>Published courses and lessons · learn.synergy-network.io</p>
      <div className="native-actions">
        <button disabled={resource.loading} onClick={resource.reload}>Refresh content</button>
        {slug && <button onClick={() => setSlug('')}>Back to catalog</button>}
      </div>
      <Resource value={resource}>{({value, receivedAt}) => (
        <>
          <SourceAge source="Learn public API read" updatedAt={receivedAt} />
          {slug ? <Lesson value={value} /> : (
            <Catalog value={value} search={search} setSearch={setSearch} openLesson={setSlug} empty="The API returned an empty published catalog." />
          )}
        </>
      )}</Resource>
    </>
  );
}

function SnapshotReader() {
  const [state, setState] = useState({status: 'idle'});
  const [slug, setSlug] = useState('');
  const [search, setSearch] = useState('');
  const requestVersion = useRef(0);
  const input = useRef(null);

  useEffect(() => () => { requestVersion.current++; }, []);

  async function openSnapshot(event) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    const version = ++requestVersion.current;
    setSlug('');
    setSearch('');
    setState({status: 'reading'});
    try {
      const snapshot = await readCurriculumSnapshot(file);
      if (version === requestVersion.current) setState({status: 'ready', snapshot});
    } catch (error) {
      if (version === requestVersion.current) setState({status: 'failed', message: error.message});
    }
  }

  function clearSnapshot() {
    requestVersion.current++;
    input.current.value = '';
    input.current.focus();
    setSlug('');
    setSearch('');
    setState({status: 'idle'});
  }

  return (
    <>
      <section className="callout">
        <p>Choose a local Learn curriculum snapshot up to 2 MB. The file stays on this device for this view.</p>
        <label className="learn-snapshot-input">
          Open Learn snapshot
          <input ref={input} type="file" accept=".json,application/json" onChange={openSnapshot} />
        </label>
        {state.status !== 'idle' && (
          <button onClick={clearSnapshot}>{state.status === 'reading' ? 'Cancel snapshot read' : 'Clear snapshot'}</button>
        )}
        {state.status === 'reading' && <p role="status">Reading snapshot…</p>}
        {state.status === 'failed' && <p role="alert">{state.message}</p>}
      </section>
      {state.status === 'ready' && (
        <>
          <p className="learn-snapshot-source">
            Offline snapshot. Declared Learn source revision <code>{state.snapshot.sourceRevision}</code>. Current publication status is unknown.
          </p>
          {slug ? (
            <>
              <button onClick={() => setSlug('')}>Back to catalog</button>
              <Lesson value={state.snapshot.lessons.get(slug)} />
            </>
          ) : (
            <Catalog value={state.snapshot.catalog} search={search} setSearch={setSearch} openLesson={setSlug} empty="The snapshot catalog is empty." />
          )}
        </>
      )}
    </>
  );
}

export function LearnApp() {
  const native = useNative();
  return <LearnReader liveAllowed={native.permit('learn', 'readNetwork')} />;
}

export function LearnReader({liveAllowed = true}) {
  const [mode, setMode] = useState('live');
  return (
    <div className="learn-migrated">
      <header>
        <h1>Synergy Learn</h1>
        <div className="native-actions" role="group" aria-label="Curriculum source">
          <button aria-pressed={mode === 'live'} onClick={() => setMode('live')}>Live catalog</button>
          <button aria-pressed={mode === 'snapshot'} onClick={() => setMode('snapshot')}>Offline snapshot</button>
        </div>
      </header>
      {mode === 'snapshot' ? <SnapshotReader /> : liveAllowed ? <LiveReader /> : (
        <p>Allow Learn public reads in Security &amp; permissions.</p>
      )}
      <p>Wallet login, synchronized progress, scored assessments and rewards require their separate authenticated integrations.</p>
    </div>
  );
}
