/**
 * Code Editor — Phase 2 entry.
 *
 * Two-pane layout: file tree on the left, Monaco on the right.
 * Clicking a file in the tree fetches its content over REST and
 * opens it in Monaco read-only (Phase 3 enables save).
 *
 * The shell pre-clones the registered `<template>` into the body
 * before invoking us — see `wpdc_render_editor_template()` in
 * `includes/code-editor/window.php`. We locate the declarative
 * mount points and elevate them.
 *
 * @public
 * @since 0.18.0
 */

import { createModelCache, languageFor } from './file-models';
import { loadMonaco } from './monaco-bootstrap';
import { fetchFile, RestError } from './rest';
import { mountFileTree, type FileTreeHandle } from './tree';

import type * as Monaco from 'monaco-editor';

type RenderCallback = ( body: HTMLElement ) => void;

declare global {
	interface Window {
		wpDesktopNativeWindows?: Record< string, RenderCallback | undefined >;
	}
}

/** Mount selectors — kept in lockstep with `wpdc_render_editor_template()`. */
export const ROOT_SELECTOR = '[data-wpdc-editor-root]';
export const MONACO_MOUNT_SELECTOR = '[data-wpdc-editor-monaco]';
export const LOADING_CLASS = 'wpdc-editor--loading';
export const ERROR_CLASS = 'wpdc-editor--error';

/**
 * Build the two-pane layout: tree | editor split, with a status bar
 * underneath the editor.
 *
 * Returns the elements the rest of the entry needs to wire behaviour
 * (mount the file tree, host Monaco, update the status bar).
 */
function buildShell( root: HTMLElement, monacoSlot: HTMLElement ): {
	treeMount: HTMLElement;
	editorMount: HTMLElement;
	statusBar: HTMLElement;
} {
	root.classList.add( 'wpdc-editor--phase2' );

	const split = document.createElement( 'div' );
	split.className = 'wpdc-editor__split';

	const treeMount = document.createElement( 'div' );
	treeMount.className = 'wpdc-editor__tree';

	const right = document.createElement( 'div' );
	right.className = 'wpdc-editor__right';

	const editorMount = document.createElement( 'div' );
	editorMount.className = 'wpdc-editor__monaco-host';

	const statusBar = document.createElement( 'div' );
	statusBar.className = 'wpdc-editor__statusbar';
	statusBar.textContent = 'Select a file from the tree.';

	right.append( editorMount, statusBar );
	split.append( treeMount, right );

	// Slot the Monaco host into the spot the existing template
	// reserved (`[data-wpdc-editor-monaco]`); replace any earlier
	// content with the new split layout. Keeps the template
	// contract — JS only enhances the slot the PHP declared.
	monacoSlot.replaceChildren( split );

	return { treeMount, editorMount, statusBar };
}

/** Format file size as "12 KB" / "1.2 MB" — for the status bar. */
function formatBytes( n: number ): string {
	if ( n < 1024 ) {
		return `${ n } B`;
	}
	if ( n < 1024 * 1024 ) {
		return `${ ( n / 1024 ).toFixed( 1 ) } KB`;
	}
	return `${ ( n / ( 1024 * 1024 ) ).toFixed( 2 ) } MB`;
}

function formatMtime( mtime: number ): string {
	if ( ! mtime ) {
		return '';
	}
	return new Date( mtime * 1000 ).toLocaleString();
}

/**
 * Render callback handed to the shell.
 *
 * The shell has already cloned the template into the body. We find
 * the Monaco mount slot the template declared and replace it with
 * the two-pane Phase-2 layout.
 */
async function renderEditor( body: HTMLElement ): Promise< void > {
	const root = body.querySelector< HTMLElement >( ROOT_SELECTOR );
	const monacoSlot = body.querySelector< HTMLElement >( MONACO_MOUNT_SELECTOR );
	if ( ! root || ! monacoSlot ) {
		// eslint-disable-next-line no-console
		console.error(
			'[wp-desktop-code-editor] Template mount nodes missing; ensure wpdc_render_editor_template ran.',
		);
		return;
	}

	let monaco: typeof Monaco;
	try {
		monaco = await loadMonaco();
	} catch ( err ) {
		root.classList.remove( LOADING_CLASS );
		root.classList.add( ERROR_CLASS );
		monacoSlot.textContent =
			err instanceof Error ? err.message : 'Failed to load Monaco.';
		return;
	}

	const { treeMount, editorMount, statusBar } = buildShell( root, monacoSlot );

	// Empty placeholder model so the editor mounts immediately rather
	// than waiting for the first file open. Replaced on every
	// `setModel` below.
	const placeholder = monaco.editor.createModel(
		'// Click a file in the tree to open it.\n',
		'plaintext',
	);

	const editor = monaco.editor.create( editorMount, {
		model: placeholder,
		theme: 'vs-dark',
		automaticLayout: true,
		minimap: { enabled: true },
		fontSize: 13,
		fontFamily:
			'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
		// Phase 2 is read-only; Phase 3 flips this to false +
		// enables the save flow.
		readOnly: true,
		scrollBeyondLastLine: false,
	} );

	const models = createModelCache();
	const inflight = new Map< string, AbortController >();
	let activeRequest: AbortController | null = null;

	const setStatus = ( text: string, kind: 'info' | 'error' = 'info' ) => {
		statusBar.textContent = text;
		statusBar.classList.toggle(
			'wpdc-editor__statusbar--error',
			kind === 'error',
		);
	};

	const openFile = async ( path: string ): Promise< void > => {
		// Cancel a pending open if the user clicks rapidly.
		activeRequest?.abort();
		const ac = new AbortController();
		activeRequest = ac;
		inflight.set( path, ac );

		const fast = models.get( path );
		if ( fast ) {
			editor.setModel( fast );
			setStatus(
				`${ path } · ${ languageFor( path ) } · cached`,
			);
			// Still revalidate against the server so we don't serve
			// a stale buffer if the file changed externally.
		}

		setStatus( `${ path } · loading…` );

		try {
			const file = await fetchFile( path, ac.signal );
			if ( ac.signal.aborted ) {
				return;
			}
			const model = models.open( monaco, path, file.content );
			editor.setModel( model );
			setStatus(
				`${ path } · ${ languageFor( path ) } · ${ formatBytes(
					file.size,
				) } · ${ formatMtime( file.mtime ) }`,
			);
		} catch ( err ) {
			if ( ( err as Error ).name === 'AbortError' ) {
				return;
			}
			let msg = 'Failed to open file.';
			if ( err instanceof RestError ) {
				msg = `${ err.code } — ${ err.message }`;
			} else if ( err instanceof Error ) {
				msg = err.message;
			}
			setStatus( msg, 'error' );
		} finally {
			inflight.delete( path );
			if ( activeRequest === ac ) {
				activeRequest = null;
			}
		}
	};

	const tree: FileTreeHandle = mountFileTree( {
		mount: treeMount,
		onOpen: ( path ) => {
			void openFile( path );
		},
	} );

	root.classList.remove( LOADING_CLASS );

	// Light-touch teardown. The shell doesn't currently feed us a
	// "window closed" signal at this layer (the render callback's
	// return value would be it — Phase 6 hooks that up); for now,
	// the cache lives until the page reloads, which is fine for
	// read-only Phase 2.
	void tree; // (lint: handle is intentionally retained)
}

const registry =
	( window.wpDesktopNativeWindows ??
		( window.wpDesktopNativeWindows = {} ) ) as Record<
		string,
		RenderCallback | undefined
	>;
registry[ 'wpdc-editor' ] = ( body: HTMLElement ) => {
	void renderEditor( body );
};
