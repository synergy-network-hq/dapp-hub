# Open an offline Learn curriculum snapshot

Select **Offline snapshot** and choose a version 1 Learn JSON export up to 2 MB. Search the catalog and open its lessons using the same reader as the live catalog. The file stays in the current view until you clear it, switch sources, or leave Learn. The source revision comes from the file. It does not establish current publication or verify who prepared the file.

The version 1 envelope contains `schemaVersion` set to `1`, `kind` set to `synergy-learn-curriculum-snapshot`, a 40-character hexadecimal `sourceRevision`, `catalog` with `paths` and `lessons` arrays, and a top-level `lessons` array containing the reading blocks for each catalog lesson. Every lesson slug, title and subtitle must match its catalog entry. The same bounded parsers handle published and offline content. Checkpoints retain the prompt only.

To prepare an owner-seed snapshot, run the following from the Hub root with Node 22.19 or later. Set `learn_owner_checkout` to a private local checkout of the Learn owner repository and use the reviewed owner revision. The inspected revision below produces five seeded paths and 35 lessons. Owner seed publish flags determine the projection, and the publication state of the deployed Learn database can differ.

```sh
learn_owner_checkout='/absolute/path/to/synergy-learn'
learn_source_revision='0cba514482d4e9a1571921ba2cf635f1ae1cc0ba'
{
  git -C "$learn_owner_checkout" show "${learn_source_revision}:packages/learn-shared/src/content.ts"
  cat <<'JS'

const {createCurriculumSnapshot} = await import('./learn/src/snapshot.js');
const snapshot = createCurriculumSnapshot(createInitialContent(), process.env.LEARN_SOURCE_REVISION);
console.log(JSON.stringify(snapshot));
JS
} | LEARN_SOURCE_REVISION="$learn_source_revision" node --input-type=module-typescript > /tmp/synergy-learn-snapshot.json
```

Review the output before distributing any snapshot. Keep the private generator, draft materials and generated snapshots outside this public repository. The shipped reader contains no course content.
