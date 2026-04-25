/**
 * Code Editor — Phase 1b entry.
 *
 * Mounts Monaco into the window body, configures the bundled language
 * services (TS / JS / JSX / TSX / CSS / SCSS / HTML / JSON / MD), and
 * exposes a small language picker so the user can flip between
 * sample files and verify each language's IntelliSense.
 *
 * Phase 2 replaces the language picker + samples with a real file
 * tree + REST file I/O. The Monaco mount path stays.
 *
 * @public
 * @since 0.18.0
 */

import { loadMonaco } from './monaco-bootstrap';
import { SAMPLES, type Sample } from './samples';

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

/** Ensure each sample only spawns one Monaco model regardless of tab thrashing. */
const modelCache = new Map< string, Monaco.editor.ITextModel >();

function getOrCreateModel(
	monaco: typeof Monaco,
	sample: Sample,
): Monaco.editor.ITextModel {
	const cached = modelCache.get( sample.id );
	if ( cached && ! cached.isDisposed() ) {
		return cached;
	}
	const uri = monaco.Uri.parse( sample.uri );
	const existing = monaco.editor.getModel( uri );
	if ( existing ) {
		modelCache.set( sample.id, existing );
		return existing;
	}
	const model = monaco.editor.createModel( sample.content, sample.language, uri );
	modelCache.set( sample.id, model );
	return model;
}

/**
 * Build the language picker — a `<select>` between the title bar and
 * the editor. Phase 2 replaces this with a file tree.
 */
function buildLanguagePicker(
	current: Sample,
	onPick: ( s: Sample ) => void,
): HTMLElement {
	const wrap = document.createElement( 'div' );
	wrap.className = 'wpdc-editor__picker';

	const label = document.createElement( 'label' );
	label.className = 'wpdc-editor__picker-label';
	label.textContent = 'Sample';

	const select = document.createElement( 'select' );
	select.className = 'wpdc-editor__picker-select';
	for ( const sample of SAMPLES ) {
		const opt = document.createElement( 'option' );
		opt.value = sample.id;
		opt.textContent = sample.label;
		if ( sample.id === current.id ) {
			opt.selected = true;
		}
		select.appendChild( opt );
	}
	select.addEventListener( 'change', () => {
		const next = SAMPLES.find( ( s ) => s.id === select.value );
		if ( next ) {
			onPick( next );
		}
	} );

	const id = `wpdc-editor-picker-${ Math.random().toString( 36 ).slice( 2, 8 ) }`;
	select.id = id;
	label.htmlFor = id;

	wrap.append( label, select );
	return wrap;
}

/**
 * Render callback handed to the shell.
 *
 * The shell has already cloned the `<template id="wpdm-native-window-
 * wpdc-editor">` content into the body — see
 * `wpdc_render_editor_template()` in `includes/code-editor/window.php`.
 * We locate the declarative mount points and elevate them.
 */
async function renderEditor( body: HTMLElement ): Promise< void > {
	const root = body.querySelector< HTMLElement >( ROOT_SELECTOR );
	const mount = body.querySelector< HTMLElement >( MONACO_MOUNT_SELECTOR );
	if ( ! root || ! mount ) {
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
		mount.textContent =
			err instanceof Error ? err.message : 'Failed to load Monaco.';
		return;
	}

	// Default to PHP so the existing Phase 1a screenshot still
	// matches; user picks any other from the language selector.
	let active: Sample = SAMPLES.find( ( s ) => s.id === 'php' ) ?? SAMPLES[ 0 ];

	const editor = monaco.editor.create( mount, {
		model: getOrCreateModel( monaco, active ),
		theme: 'vs-dark',
		automaticLayout: true,
		minimap: { enabled: true },
		fontSize: 13,
		fontFamily:
			'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
		readOnly: false,
		scrollBeyondLastLine: false,
	} );

	const picker = buildLanguagePicker( active, ( next ) => {
		active = next;
		editor.setModel( getOrCreateModel( monaco, next ) );
	} );
	root.insertBefore( picker, mount );

	root.classList.remove( LOADING_CLASS );
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
