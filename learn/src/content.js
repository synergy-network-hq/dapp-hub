const slug=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9-]{0,127}$/.test(value);
const text=(value,max=8000)=>typeof value==='string'&&value.length<=max;
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const fail=()=>{throw Error('Learn returned unsupported content; no sample lesson or empty catalog substituted.');};
export function lessonPath(value){if(!slug(value))throw Error('Unsupported lesson identifier');return 'lessons/'+value;}
export function catalogContent(value){
 if(!object(value)||!Array.isArray(value.paths)||value.paths.length>500||!Array.isArray(value.lessons)||value.lessons.length>2000)fail();
 for(const rows of [value.paths,value.lessons]){if(new Set(rows.map(row=>row?.slug)).size!==rows.length)fail();for(const row of rows)if(!object(row)||!slug(row.slug)||!text(row.title,240)||['description','subtitle','difficulty'].some(key=>row[key]!=null&&!text(row[key],8000))||(row.estimatedMinutes!=null&&(!Number.isFinite(row.estimatedMinutes)||row.estimatedMinutes<0||row.estimatedMinutes>100000)))fail();}
 return {paths:value.paths.map(({slug,title,description,difficulty,estimatedMinutes})=>({slug,title,description,difficulty,estimatedMinutes})),lessons:value.lessons.map(({slug,title,subtitle})=>({slug,title,subtitle}))};
}
export function lessonContent(value,expectedSlug){
 if(!object(value)||!text(value.title,240)||(value.subtitle!=null&&!text(value.subtitle))||(value.slug!=null&&value.slug!==expectedSlug)||!Array.isArray(value.content)||value.content.length>500)fail();
 const content=value.content.map(block=>{
  if(!object(block)||!text(block.type,80))fail();
  for(const field of ['text','title','question'])if(block[field]!=null&&!text(block[field],16000))fail();
  if(['heading','paragraph'].includes(block.type)&&!text(block.text,16000))fail();
  if(block.type==='quiz-checkpoint'&&!text(block.question??block.text,16000))fail();
  if(block.type==='code'){if(!text(block.code,64000))fail();return {type:block.type,code:block.code};}
  if(block.type==='checklist'){if(!Array.isArray(block.items)||block.items.length>200||block.items.some(item=>!text(item,4000)))fail();return {type:block.type,items:block.items};}
  if(block.type==='comparison-table'){if(!Array.isArray(block.columns)||block.columns.length>20||block.columns.some(c=>!text(c,1000))||!Array.isArray(block.rows)||block.rows.length>200||block.rows.some(row=>!Array.isArray(row)||row.length!==block.columns.length||row.some(c=>!text(c,4000))))fail();return {type:block.type,title:block.title,columns:block.columns,rows:block.rows};}
  return {type:block.type,text:block.text,title:block.title,question:block.question};
 });return {title:value.title,subtitle:value.subtitle,content};
}
