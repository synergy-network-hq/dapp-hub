import {catalogContent, lessonContent} from './content.js';

export const MAX_SNAPSHOT_BYTES = 2_000_000;
const KIND = 'synergy-learn-curriculum-snapshot';
const REVISION = /^[a-f0-9]{40}$/;

export function parseCurriculumSnapshot(text) {
  if (typeof text !== 'string' || text.length > MAX_SNAPSHOT_BYTES
    || new TextEncoder().encode(text).length > MAX_SNAPSHOT_BYTES) {
    throw new Error('Choose a Learn snapshot of 2 MB or less.');
  }
  let snapshot;
  try {
    snapshot = JSON.parse(text);
  } catch {
    throw new Error('The snapshot is not readable JSON.');
  }
  if (snapshot?.schemaVersion !== 1 || snapshot.kind !== KIND || typeof snapshot.sourceRevision !== 'string'
    || !REVISION.test(snapshot.sourceRevision) || !Array.isArray(snapshot.lessons)) {
    throw new Error('Choose a version 1 Learn curriculum snapshot.');
  }

  const catalog = catalogContent(snapshot.catalog);
  if (snapshot.lessons.length !== catalog.lessons.length) {
    throw new Error('The snapshot lesson list differs from its catalog.');
  }
  const catalogLessons = new Map(catalog.lessons.map(lesson => [lesson.slug, lesson]));
  const lessons = new Map();
  for (const row of snapshot.lessons) {
    const entry = catalogLessons.get(row?.slug);
    if (!entry || lessons.has(row.slug) || row.title !== entry.title || (row.subtitle ?? null) !== (entry.subtitle ?? null)) {
      throw new Error('The snapshot lesson list differs from its catalog.');
    }
    lessons.set(row.slug, lessonContent(row, row.slug));
  }
  return {sourceRevision: snapshot.sourceRevision, catalog, lessons};
}

export async function readCurriculumSnapshot(file) {
  if (file.size > MAX_SNAPSHOT_BYTES) throw new Error('Choose a Learn snapshot of 2 MB or less.');
  let text;
  try {
    const bytes = await file.slice(0, MAX_SNAPSHOT_BYTES + 1).arrayBuffer();
    text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  } catch {
    throw new Error('The snapshot could not be read as UTF-8.');
  }
  return parseCurriculumSnapshot(text);
}

// Run at the pinned owner revision when preparing a local reading snapshot.
export function createCurriculumSnapshot(seed, sourceRevision) {
  const paths = seed.paths.filter(path => path.publishState === 'published');
  const pathSlugs = new Set(paths.map(path => path.slug));
  const moduleSlugs = new Set(seed.modules.filter(module => module.publishState === 'published'
    && pathSlugs.has(module.pathSlug)).map(module => module.slug));
  const sourceLessons = seed.lessons.filter(lesson => lesson.publishState === 'published' && moduleSlugs.has(lesson.moduleSlug));
  const snapshot = {
    schemaVersion: 1,
    kind: KIND,
    sourceRevision,
    catalog: catalogContent({paths, lessons: sourceLessons}),
    lessons: sourceLessons.map(lesson => ({
      slug: lesson.slug,
      ...lessonContent(lesson, lesson.slug),
    })),
  };
  parseCurriculumSnapshot(JSON.stringify(snapshot));
  return snapshot;
}
