/**
 * Copy the connect screen's HTML next to its compiled script.
 *
 * `tsc` compiles `app/src/renderer/connect.ts` to
 * `app/dist/renderer/connect.js` and, being a TypeScript compiler,
 * ignores the `.html` sitting beside it. The page's CSP is
 * `script-src 'self'`, which over `file://` means "the same directory"
 * in practice — so the HTML has to end up next to the JS rather than
 * reaching back across directories for it.
 *
 * One file, one copy, no bundler.
 */

import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname( fileURLToPath( import.meta.url ) );
const from = join( root, '..', 'app', 'src', 'renderer', 'connect.html' );
const to = join( root, '..', 'app', 'dist', 'renderer', 'connect.html' );

mkdirSync( dirname( to ), { recursive: true } );
cpSync( from, to );

console.log( '[openstation-electron] copied connect.html into app/dist/renderer/' );
