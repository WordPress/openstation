/**
 * Code Editor — Phase 3 entry.
 *
 * Two-pane layout: file tree on the left, Monaco on the right with
 * a status bar underneath. Clicking a file in the tree fetches its
 * content over REST and opens it in Monaco. **Editing is now
 * enabled** — Cmd/Ctrl+S writes back through `/code/file`.
 *
 * The shell pre-clones the registered `<template>` into the body
 * before invoking us — see `wpdc_render_editor_template()` in
 * `includes/code-editor/window.php`. We locate the declarative
 * mount points and elevate them.
 *
 * @public
 * @since 0.18.0
 */

import { showConflictDialog } from './conflict-dialog';
import { createModelCache, languageFor } from './file-models';
import { loadMonaco } from './monaco-bootstrap';
import {
	fetchFile,
	RestError,
	saveFile,
	type ConflictData,
} from './rest';
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

/** Per-open-file state — what the editor needs to save it back. */
interface OpenFile {
	path: string;
	mtime: number;
	size: number;
}

/**
 * Build the two-pane layout: tree | editor split, with a status bar
 * underneath the editor.
 */
function buildShell( root: HTMLElement, monacoSlot: HTMLElement ): {
	treeMount: HTMLElement;
	editorMount: HTMLElement;
	statusBar: HTMLElement;
} {
	root.classList.add( 'wpdc-editor--phase3' );

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

	monacoSlot.replaceChildren( split );

	return { treeMount, editorMount, statusBar };
}

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

function formatTime( ts: number ): string {
	return new Date( ts ).toLocaleTimeString();
}

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
		// Phase 3 — editing on. Save shortcut wired below.
		readOnly: false,
		scrollBeyondLastLine: false,
	} );

	const models = createModelCache();
	let activeFile: OpenFile | null = null;
	let openController: AbortController | null = null;
	let saveController: AbortController | null = null;

	const setStatus = (
		text: string,
		kind: 'info' | 'error' | 'success' = 'info',
	): void => {
		statusBar.textContent = text;
		statusBar.classList.toggle(
			'wpdc-editor__statusbar--error',
			kind === 'error',
		);
		statusBar.classList.toggle(
			'wpdc-editor__statusbar--success',
			kind === 'success',
		);
	};

	const renderFileStatus = ( file: OpenFile, suffix: string = '' ): void => {
		setStatus(
			`${ file.path } · ${ languageFor( file.path ) } · ${ formatBytes(
				file.size,
			) } · ${ formatMtime( file.mtime ) }${ suffix }`,
		);
	};

	const openFile = async ( path: string ): Promise< void > => {
		openController?.abort();
		const ac = new AbortController();
		openController = ac;

		setStatus( `${ path } · loading…` );

		try {
			const file = await fetchFile( path, ac.signal );
			if ( ac.signal.aborted ) {
				return;
			}
			const model = models.open( monaco, path, file.content );
			editor.setModel( model );
			activeFile = {
				path: file.path,
				mtime: file.mtime,
				size: file.size,
			};
			renderFileStatus( activeFile );
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
			if ( openController === ac ) {
				openController = null;
			}
		}
	};

	/**
	 * Save the current model to disk. Handles 409 conflicts by
	 * showing the dialog and retrying as the user requested
	 * (reload from disk / overwrite anyway / cancel).
	 *
	 * Returns silently — status bar is the side channel.
	 */
	const saveActiveFile = async (): Promise< void > => {
		if ( ! activeFile ) {
			return;
		}
		const file = activeFile;
		const model = editor.getModel();
		if ( ! model ) {
			return;
		}
		const content = model.getValue();

		saveController?.abort();
		const ac = new AbortController();
		saveController = ac;

		setStatus( `${ file.path } · saving…` );

		try {
			const result = await saveFile( file.path, content, file.mtime, ac.signal );
			if ( ac.signal.aborted ) {
				return;
			}
			activeFile = {
				path: result.path,
				mtime: result.mtime,
				size: result.size,
			};
			renderFileStatus(
				activeFile,
				` · saved at ${ formatTime( Date.now() ) }`,
			);
		} catch ( err ) {
			if ( ( err as Error ).name === 'AbortError' ) {
				return;
			}
			if ( err instanceof RestError && err.code === 'wpdc_conflict' ) {
				const data = ( err.data ?? null ) as ConflictData | null;
				if ( ! data ) {
					setStatus(
						`${ file.path } · conflict but no server data; reload manually.`,
						'error',
					);
					return;
				}
				const choice = await showConflictDialog( {
					path: file.path,
					serverMtime: data.server_mtime,
					serverSize: data.server_size,
				} );
				if ( choice === 'cancel' ) {
					setStatus(
						`${ file.path } · save cancelled`,
						'error',
					);
					return;
				}
				if ( choice === 'reload' ) {
					model.setValue( data.server_content );
					activeFile = {
						path: file.path,
						mtime: data.server_mtime,
						size: data.server_size,
					};
					renderFileStatus(
						activeFile,
						' · reloaded from disk',
					);
					return;
				}
				// Overwrite — re-issue the save with the server's
				// mtime so the optimistic-concurrency check passes.
				activeFile = {
					path: file.path,
					mtime: data.server_mtime,
					size: data.server_size,
				};
				await saveActiveFile();
				return;
			}
			let msg = 'Failed to save.';
			if ( err instanceof RestError ) {
				msg = `${ err.code } — ${ err.message }`;
			} else if ( err instanceof Error ) {
				msg = err.message;
			}
			setStatus( `${ file.path } · ${ msg }`, 'error' );
		} finally {
			if ( saveController === ac ) {
				saveController = null;
			}
		}
	};

	// Bind Cmd/Ctrl+S inside Monaco. `addCommand` runs only when the
	// editor has focus — exactly what we want; pressing Cmd-S while
	// the tree is focused shouldn't trigger the editor's save. The
	// `KeyMod | KeyCode` bitwise composition is the Monaco-canonical
	// keybinding API — disabling no-bitwise just for these lines.
	editor.addCommand(
		// eslint-disable-next-line no-bitwise
		monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
		() => {
			void saveActiveFile();
		},
	);
	editor.addAction( {
		id: 'wpdc.saveFile',
		label: 'Save File',
		// eslint-disable-next-line no-bitwise
		keybindings: [ monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS ],
		contextMenuGroupId: 'navigation',
		run: () => {
			void saveActiveFile();
		},
	} );

	const tree: FileTreeHandle = mountFileTree( {
		mount: treeMount,
		onOpen: ( path ) => {
			void openFile( path );
		},
	} );

	root.classList.remove( LOADING_CLASS );
	void tree;
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
