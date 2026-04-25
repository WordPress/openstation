/**
 * Code Editor — Phase 1a entry.
 *
 * Registers a native-window render callback at
 * `window.wpDesktopNativeWindows['wpdc-editor']`. The shell pre-clones
 * our `<template>` into the window body before invoking us, so this
 * file is purely about *enhancement*: find the mount nodes the
 * template declared, light them up.
 *
 * Phase 1a scope: Monaco renders, syntax highlighting works, no
 * workers, no file tree, no save. Subsequent phases (file tree, REST
 * I/O, IntelliSense providers) layer on top per
 * `/Users/daniellopez/.claude/plans/okay-we-can-t-use-frolicking-otter.md`.
 *
 * Extensibility:
 *   - The PHP template is filterable via
 *     `wp_desktop_code_editor_template_html`. Restyle freely; keep the
 *     `[data-wpdc-editor-monaco]` mount node and the JS finds it.
 *   - The mount selector itself is filterable via the constant
 *     {@link MONACO_MOUNT_SELECTOR} — exported so plugins layering on
 *     top of the editor (Phase 6's open-from-elsewhere protocol, etc.)
 *     can co-locate logic.
 *
 * @public
 * @since 0.18.0
 */

import { loadMonaco } from './monaco-bootstrap';

import type * as Monaco from 'monaco-editor';

type RenderCallback = ( body: HTMLElement ) => void;

declare global {
	interface Window {
		wpDesktopNativeWindows?: Record< string, RenderCallback | undefined >;
	}
}

/** Sample file used during Phase 1a to verify rendering + syntax. */
const SAMPLE_PHP = `<?php
/**
 * Welcome to the WP Desktop Code editor.
 *
 * Phase 1a: Monaco renders inside a native desktop window with PHP
 * syntax highlighting. No workers, no file tree, no save.
 *
 * Phase 1b adds full IntelliSense for JS/TS/JSX/TSX/CSS/SCSS/HTML/MD.
 * Phase 5 adds WordPress-aware PHP IntelliSense.
 */

function wpdc_say_hello( $name = 'world' ) {
    return sprintf( 'Hello, %s!', sanitize_text_field( $name ) );
}

add_action( 'init', function () {
    // Try editing this file inside the editor window.
    error_log( wpdc_say_hello( 'WP Desktop Mode' ) );
} );
`;

/** Mount selector — kept in lockstep with the PHP template. */
export const ROOT_SELECTOR = '[data-wpdc-editor-root]';
export const LOADING_SELECTOR = '[data-wpdc-editor-loading]';
export const MONACO_MOUNT_SELECTOR = '[data-wpdc-editor-monaco]';
export const LOADING_CLASS = 'wpdc-editor--loading';
export const ERROR_CLASS = 'wpdc-editor--error';

/**
 * Render callback handed to the shell.
 *
 * The shell has already cloned the `<template id="wpdm-native-window-
 * wpdc-editor">` content into the body before calling us, so we just
 * locate the declarative mount points and elevate them.
 */
async function renderEditor( body: HTMLElement ): Promise< void > {
	const root = body.querySelector< HTMLElement >( ROOT_SELECTOR );
	const mount = body.querySelector< HTMLElement >( MONACO_MOUNT_SELECTOR );
	if ( ! root || ! mount ) {
		// Template wasn't cloned (missing on the page) — shell logged
		// the issue. Bail rather than fight the DOM.
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

	// Fresh model. Phase 2 will replace this with a per-tab model and
	// drive `setModel` from tab switches.
	const model = monaco.editor.createModel( SAMPLE_PHP, 'php' );

	monaco.editor.create( mount, {
		model,
		theme: 'vs-dark',
		automaticLayout: true,
		minimap: { enabled: true },
		fontSize: 13,
		fontFamily:
			'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
		// Phase 1a: read-only would be safer (no save flow yet), but
		// we want the user to feel the editor in their hands. Edits
		// are in-memory — closing the window discards them.
		readOnly: false,
		scrollBeyondLastLine: false,
	} );

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
