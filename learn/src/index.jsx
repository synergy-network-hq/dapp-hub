import {useState} from 'react';
import {useNative,learn,Resource,useResource} from '@synergy-network/portal-native/dapp-sdk';
import {SourceAge} from '@synergy-network/dapp-data-view/source-age';
import {catalogContent,lessonContent,lessonPath} from './content.js';
import './learn.css';
export function LessonBlock({block}){
 if(block.type==='heading')return <h2>{block.text}</h2>;
 if(block.type==='paragraph')return <p>{block.text}</p>;
 if(block.type==='code')return <pre className="code-block"><code>{block.code}</code></pre>;
 if(block.type==='checklist')return <ul className="check-list">{block.items.map((item,i)=><li key={i}>{item}</li>)}</ul>;
 if(block.type==='comparison-table')return <div className="comparison-table"><h3>{block.title}</h3><table><thead><tr>{block.columns.map((item,i)=><th key={i}>{item}</th>)}</tr></thead><tbody>{block.rows.map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>;
 if(block.type==='quiz-checkpoint')return <section className="callout"><h3>Lesson checkpoint</h3><p>{block.question||block.text}</p><p>Scored assessment submission requires its authenticated integration.</p></section>;
 return <section className="callout"><strong>{block.title}</strong><p>{block.text||'This content block is not supported by the reader.'}</p></section>;
}
export function LearnApp(){const n=useNative();return n.permit('learn','readNetwork')?<LearnReader/>:<p>Allow Learn public reads in Security & permissions.</p>;}
export function LearnReader(){
 const [slug,setSlug]=useState(''),[search,setSearch]=useState('');
 const resource=useResource(async signal=>{const value=await learn(slug?lessonPath(slug):'catalog',{signal});return {value:slug?lessonContent(value,slug):catalogContent(value),receivedAt:Date.now()};},slug);
 return <div className="learn-migrated"><header><h1>Synergy Learn</h1><p>Published courses and lessons · learn.synergy-network.io</p><div className="native-actions"><button disabled={resource.loading} onClick={resource.reload}>Refresh content</button>{slug&&<button onClick={()=>setSlug('')}>Back to catalog</button>}</div></header><Resource value={resource}>{({value,receivedAt})=><><SourceAge source="Learn public API read" updatedAt={receivedAt}/>{slug?<article className="lesson-content glass-panel"><h1>{value.title}</h1><p>{value.subtitle}</p>{value.content.map((block,i)=><LessonBlock block={block} key={i}/>)}</article>:<><label>Search published content<input maxLength={160} value={search} onChange={event=>setSearch(event.target.value)}/></label><h2>Learning paths</h2><div className="card-grid">{value.paths.filter(path=>path.title.toLowerCase().includes(search.toLowerCase())).map(path=><article className="path-card glass-panel" key={path.slug}><h3>{path.title}</h3><p>{path.description}</p><div className="chip-row"><span>{path.difficulty||'Difficulty not reported'}</span><span>{path.estimatedMinutes==null?'Duration not reported':`${path.estimatedMinutes} min`}</span></div></article>)}</div><h2>Published lessons</h2>{value.lessons.filter(lesson=>lesson.title.toLowerCase().includes(search.toLowerCase())).map(lesson=><article className="module-row glass-panel" key={lesson.slug}><h3>{lesson.title}</h3><p>{lesson.subtitle}</p><button onClick={()=>setSlug(lesson.slug)}>Read lesson</button></article>)}{!value.paths.length&&!value.lessons.length&&<p>The API returned an empty published catalog.</p>}</>}</>}</Resource><p>No sample content or progress is substituted when the API is unavailable. Wallet login, progress sync, scored assessments and rewards require their separate authenticated integrations.</p></div>;
}
