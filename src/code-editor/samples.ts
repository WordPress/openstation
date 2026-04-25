/**
 * Code Editor — Phase 1b smoke-test samples.
 *
 * One snippet per supported language, hand-written to exercise the
 * IntelliSense feature you'd most want to verify works:
 *
 *   - **ts / tsx** — generic types, JSX intrinsics, hover signatures.
 *   - **js / jsx** — JSDoc-driven inference, JSX intrinsics.
 *   - **css / scss** — property completion, color hover, validation.
 *   - **html** — tag/attribute completion, embedded language hints.
 *   - **json** — quote/comma diagnostics.
 *   - **md** — markdown tokenization (no IntelliSense, just paint).
 *   - **php** — placeholder; full PHP IntelliSense lands in Phase 5.
 *
 * Phase 2 replaces this whole module with the live file tree.
 *
 * @since 0.18.0
 */

export interface Sample {
	id: string;
	label: string;
	language: string;
	uri: string;
	content: string;
}

export const SAMPLES: ReadonlyArray< Sample > = [
	{
		id: 'php',
		label: 'PHP',
		language: 'php',
		uri: 'inmemory://samples/sample.php',
		content: `<?php
/**
 * Welcome to the WP Desktop Code editor.
 *
 * Phase 1b: TypeScript / JavaScript / CSS / SCSS / HTML / JSON
 * IntelliSense is online (try the language picker above this editor).
 *
 * PHP IntelliSense — including WordPress-aware completion for
 * \`add_action\`, \`wp_get_current_user\`, etc. — lands in Phase 5.
 * For now PHP gets syntax highlighting only.
 */

function wpdc_say_hello( $name = 'world' ) {
    return sprintf( 'Hello, %s!', sanitize_text_field( $name ) );
}

add_action( 'init', function () {
    error_log( wpdc_say_hello( 'WP Desktop Mode' ) );
} );
`,
	},
	{
		id: 'ts',
		label: 'TypeScript',
		language: 'typescript',
		uri: 'inmemory://samples/sample.ts',
		content: `/**
 * Try typing on a fresh line:
 *
 *   const arr = [1, 2, 3];
 *   arr.|     ← should autocomplete to .map / .filter / .reduce / .length
 *
 * Hover over an identifier to see its inferred type.
 */

interface Plugin {
	id: string;
	render: ( body: HTMLElement ) => void;
}

const plugins: Plugin[] = [
	{ id: 'jorvy', render: ( body ) => body.append( 'I am Iron Man.' ) },
];

const ids = plugins.map( ( p ) => p.id ).join( ', ' );
`,
	},
	{
		id: 'tsx',
		label: 'TSX (React)',
		language: 'typescript',
		uri: 'inmemory://samples/sample.tsx',
		content: `/**
 * Try typing inside the JSX:
 *
 *   <div onCl|     ← autocompletes to onClick / onClickCapture
 *   <input ty|     ← autocompletes to type=
 *
 * Hover \`useState\` to see its generic signature.
 */

import * as React from 'react';

interface CounterProps {
	initial?: number;
	onChange?: ( value: number ) => void;
}

export function Counter( { initial = 0, onChange }: CounterProps ) {
	const [ value, setValue ] = React.useState( initial );
	return (
		<div className="counter">
			<button onClick={ () => {
				setValue( value + 1 );
				onChange?.( value + 1 );
			} }>
				{ value }
			</button>
		</div>
	);
}
`,
	},
	{
		id: 'js',
		label: 'JavaScript',
		language: 'javascript',
		uri: 'inmemory://samples/sample.js',
		content: `/**
 * Vanilla JS — JSDoc drives inference even without TS.
 *
 *   const ev = doc.|   ← autocompletes off the inferred Document type.
 */

/** @type {Document} */
const doc = document;

const links = doc.querySelectorAll( 'a[href^="#"]' );
links.forEach( ( link ) => {
	link.addEventListener( 'click', ( e ) => e.preventDefault() );
} );
`,
	},
	{
		id: 'jsx',
		label: 'JSX',
		language: 'javascript',
		uri: 'inmemory://samples/sample.jsx',
		content: `/**
 * Vanilla JSX (no types, no imports declared in this in-memory
 * file). JSX intrinsics still autocomplete because the TS worker
 * is configured with \`jsx: 'react'\`.
 */

function Greeting( { name } ) {
	return <h1 className="greet">Hello, { name }!</h1>;
}

const root = document.getElementById( 'app' );
// Pretend ReactDOM.render(<Greeting name="World" />, root)
`,
	},
	{
		id: 'css',
		label: 'CSS',
		language: 'css',
		uri: 'inmemory://samples/sample.css',
		content: `/**
 * Try:
 *   - Hover \`#2271b1\` — color preview pops.
 *   - Type \`background-\` on a fresh line — completion lists
 *     background-color, background-image, etc.
 *   - Misspell a property — squiggle.
 */

.wp-desktop-window {
	box-sizing: border-box;
	background-color: #2271b1;
	color: white;
	padding: 12px;
	border-radius: 8px;
}

.wp-desktop-window:hover {
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}
`,
	},
	{
		id: 'scss',
		label: 'SCSS',
		language: 'scss',
		uri: 'inmemory://samples/sample.scss',
		content: `/**
 * SCSS-specific features the worker validates:
 *   - \`@include\` / \`@mixin\` completion.
 *   - Variable references — type \`$\` to see options.
 *   - Nested selectors collapse + linting.
 */

$accent: #2271b1;
$radius: 8px;

@mixin elevate( $depth: 2 ) {
	box-shadow: 0 #{ $depth * 2 }px #{ $depth * 6 }px rgba(0, 0, 0, 0.15);
}

.wp-desktop-window {
	background: $accent;
	border-radius: $radius;

	&:hover {
		@include elevate( 3 );
	}

	&__title {
		font-weight: 600;
	}
}
`,
	},
	{
		id: 'html',
		label: 'HTML',
		language: 'html',
		uri: 'inmemory://samples/sample.html',
		content: `<!--
  Try:
    - Type < on a fresh line — tag completion.
    - Inside <style>…</style> the CSS worker takes over.
    - Inside <script>…</script> the JS worker takes over.
-->
<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<title>WP Desktop Mode</title>
	<style>
		body { font-family: system-ui, sans-serif; margin: 2rem; }
		h1 { color: #2271b1; }
	</style>
</head>
<body>
	<h1>Hello, world.</h1>
	<script>
		console.log( 'Embedded JS — completion still works here.' );
	</script>
</body>
</html>
`,
	},
	{
		id: 'json',
		label: 'JSON',
		language: 'json',
		uri: 'inmemory://samples/sample.json',
		content: `{
	"name": "wp-desktop-mode",
	"version": "0.18.0",
	"description": "Renders the WordPress admin as a desktop OS.",
	"keywords": [ "wordpress", "admin", "desktop" ],
	"comment": "Try removing a comma above — the worker will squiggle it."
}
`,
	},
	{
		id: 'md',
		label: 'Markdown',
		language: 'markdown',
		uri: 'inmemory://samples/sample.md',
		content: `# WP Desktop Code editor

This sample exercises **markdown tokenization**. Monaco doesn't ship
a markdown language service, so there's no IntelliSense here — just
paint.

## What's online in Phase 1b

- TypeScript / JavaScript IntelliSense (with JSX/TSX).
- CSS / SCSS / LESS validation.
- HTML completion + embedded-language switching.
- JSON schema-flavored validation.

## What's coming

- Phase 2 — file tree backed by REST.
- Phase 3 — save flow with WP_Filesystem.
- Phase 5 — WordPress-aware PHP IntelliSense.

\`\`\`ts
// Code blocks tokenize with the right language even here.
const ok: boolean = true;
\`\`\`
`,
	},
];
