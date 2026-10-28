// What guessit says and what our parser makes of it, for paths given on the command line.
//   pnpm --filter @kinoshelf/corpus probe "Folder/Show - S01E02 - Title.mkv" ...
// Use it to understand a mis-parsed name before touching the parser.
import { GuessitParser } from '@kinoshelf/core';
import { guessit } from 'guessit-js';

const parser = new GuessitParser();
for (const path of process.argv.slice(2)) {
  const raw = guessit(path.split('/').slice(-3).join('/'));
  const fields = [
    'title',
    'alternative_title',
    'episode_title',
    'year',
    'season',
    'episode',
    'type',
    'country',
    'language',
    'date',
    'other',
    'edition',
  ];
  console.log(`\n${path}`);
  console.log(
    '  guessit:',
    JSON.stringify(
      Object.fromEntries(fields.filter((f) => raw[f] !== undefined).map((f) => [f, raw[f]])),
    ),
  );
  console.log('  parser :', JSON.stringify({ ...parser.parse(path), path: undefined }));
}
