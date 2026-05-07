// Detect whether a module file is being executed directly as the entrypoint.
// Used by every CLI in lib/* to gate the main() block. Single canonical
// implementation so we don't have four near-identical helpers in the tree.

import { pathToFileURL } from 'node:url';

export function isMain(metaUrl) {
  if (!process.argv[1]) return false;
  try {
    return metaUrl === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
}
