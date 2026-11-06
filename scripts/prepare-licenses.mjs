import { copyFile } from 'node:fs/promises';

await copyFile(
  new URL('../dist/pokecollector/3rdpartylicenses.txt', import.meta.url),
  new URL('../dist/pokecollector/browser/licenses/dependencies.txt', import.meta.url),
);
