/**
 * OS-file drop manager — floating upload-progress HUD.
 *
 * A pinned bottom-right panel that shows one row per in-flight
 * upload. Each row is a `<wpd-progress-bar>` plus a filename and a
 * Cancel / Dismiss action. The HUD subscribes to the four upload-
 * lifecycle hooks and owns nothing else — its lifecycle is purely
 * reactive:
 *
 *   - `upload-started`  → add row, store `abort` handle, indeterminate.
 *   - `upload-progress` → update value / max on the matching row.
 *   - `after-upload`    → mark success, auto-dismiss after a short
 *                         linger so the user sees the green state.
 *   - `upload-failed`   → mark failed, keep visible until dismissed.
 *
 * The panel renders into `document.body`, ignores window stacking,
 * and uses `pointer-events: auto` on the panel only so drops still
 * land on the wallpaper / windows behind it.
 *
 * Plugins can take this UI over entirely:
 *   - Set `data-desktop-mode-suppress-upload-hud` on `document.body`
 *     before the shell boots to prevent the default panel from
 *     mounting — useful when a plugin wants to handle the same
 *     hook surface with its own UI.
 */

import { addAction } from '../hooks';
import { activity } from '../activity';
import { formatBytes } from './format-bytes';
import { FILE_DROP_HOOKS } from './hooks';
import type { DropContext, DropDialogFields, DropUploadResult } from './types';

import '../ui/components/wpd-progress-bar/wpd-progress-bar';
import '../ui/components/wpd-button/wpd-button';

interface HudRow {
	file: File;
	abort: () => void;
	root: HTMLElement;
	bar: HTMLElement;
	statusEl: HTMLElement;
	cancelBtn: HTMLElement;
	state: 'running' | 'success' | 'failed' | 'aborted';
	lingerTimer: ReturnType< typeof setTimeout > | null;
}

const ROWS = new Map< File, HudRow >();
let panel: HTMLElement | null = null;

/**
 * Mount the HUD once. Idempotent — subsequent calls are no-ops.
 *
 * Called from `bootOsFileDrop`. Subscribers are attached lazily on
 * the very first started event so the cost is zero when no one ever
 * drops a file.
 */
export function mountUploadProgressHud(): void {
	if ( document.body.hasAttribute( 'data-desktop-mode-suppress-upload-hud' ) ) {
		return;
	}
	if ( ( window as unknown as { __wpdUploadHud?: boolean } ).__wpdUploadHud ) {
		return;
	}
	( window as unknown as { __wpdUploadHud?: boolean } ).__wpdUploadHud = true;

	const ns = 'desktop-mode/os-file-drop-hud';

	type StartedPayload = {
		file: File;
		fields: DropDialogFields;
		context: DropContext;
		abort: () => void;
	};
	addAction< [ StartedPayload ] >(
		FILE_DROP_HOOKS.UPLOAD_STARTED,
		ns,
		( payload ) =>
			onStarted( payload.file, payload.fields, payload.abort ),
	);

	addAction<
		[
			{
				file: File;
				fields: DropDialogFields;
				context: DropContext;
				loaded: number;
				total: number;
				indeterminate: boolean;
			},
		]
	>( FILE_DROP_HOOKS.UPLOAD_PROGRESS, ns, ( payload ) =>
		onProgress(
			payload.file,
			payload.loaded,
			payload.total,
			payload.indeterminate,
		),
	);

	addAction<
		[
			{
				file: File;
				result: DropUploadResult;
				fields: DropDialogFields;
				context: DropContext;
			},
		]
	>( FILE_DROP_HOOKS.AFTER_UPLOAD, ns, ( payload ) =>
		onComplete( payload.file, payload.fields, payload.result ),
	);

	addAction<
		[
			{
				file: File;
				error: Error;
				context: DropContext;
			},
		]
	>( FILE_DROP_HOOKS.UPLOAD_FAILED, ns, ( payload ) =>
		onFailed( payload.file, payload.error ),
	);
}

function onStarted(
	file: File,
	fields: DropDialogFields,
	abort: () => void,
): void {
	const p = ensurePanel();
	const row = document.createElement( 'div' );
	row.className = 'desktop-mode-upload-hud__row';

	const meta = document.createElement( 'div' );
	meta.className = 'desktop-mode-upload-hud__meta';

	const name = document.createElement( 'div' );
	name.className = 'desktop-mode-upload-hud__name';
	name.textContent = fields.filename || file.name;
	name.title = fields.filename || file.name;

	const statusEl = document.createElement( 'div' );
	statusEl.className = 'desktop-mode-upload-hud__status';
	statusEl.textContent = 'Uploading…';

	meta.append( name, statusEl );

	const bar = document.createElement( 'wpd-progress-bar' );
	bar.setAttribute( 'indeterminate', '' );
	bar.setAttribute( 'show-percent', '' );

	const actions = document.createElement( 'div' );
	actions.className = 'desktop-mode-upload-hud__actions';

	const cancelBtn = document.createElement( 'wpd-button' );
	cancelBtn.setAttribute( 'variant', 'tertiary' );
	cancelBtn.setAttribute( 'size', 'small' );
	cancelBtn.textContent = 'Cancel';
	cancelBtn.addEventListener( 'click', () => {
		const r = ROWS.get( file );
		if ( ! r ) {
			return;
		}
		if ( r.state === 'running' ) {
			// Mark the row immediately so the user gets feedback even
			// when we're in the "late cancel" path (server already
			// received the body; we have to wait for its response so
			// we know the attachment id to delete). The actual state
			// flip to `aborted` happens when UPLOAD_FAILED fires.
			r.statusEl.textContent = 'Cancelling…';
			( r.cancelBtn as unknown as { disabled: boolean } ).disabled = true;
			r.abort();
		} else {
			dismissRow( r );
		}
	} );
	actions.appendChild( cancelBtn );

	row.append( meta, bar, actions );
	p.querySelector( '.desktop-mode-upload-hud__list' )!.appendChild( row );

	ROWS.set( file, {
		file,
		abort,
		root: row,
		bar,
		statusEl,
		cancelBtn,
		state: 'running',
		lingerTimer: null,
	} );
	updateHeader();
}

function onProgress(
	file: File,
	loaded: number,
	total: number,
	indeterminate: boolean,
): void {
	const r = ROWS.get( file );
	if ( ! r || r.state !== 'running' ) {
		return;
	}
	if ( indeterminate || total <= 0 ) {
		r.bar.setAttribute( 'indeterminate', '' );
		r.statusEl.textContent = `${ formatBytes( loaded ) } sent`;
	} else {
		r.bar.removeAttribute( 'indeterminate' );
		r.bar.setAttribute( 'max', String( total ) );
		r.bar.setAttribute( 'value', String( loaded ) );
		r.statusEl.textContent = `${ formatBytes( loaded ) } / ${ formatBytes( total ) }`;
	}
}

function onComplete(
	file: File,
	fields: DropDialogFields,
	result: DropUploadResult,
): void {
	// Match by File identity — two drops of `photo.jpg` from
	// different folders would otherwise route each other's success
	// event to the wrong row and leave one stuck in "running"
	// forever.
	const r = ROWS.get( file );
	if ( ! r ) {
		return;
	}
	r.state = 'success';
	r.bar.removeAttribute( 'indeterminate' );
	r.bar.setAttribute( 'value', '100' );
	r.bar.setAttribute( 'max', '100' );
	r.bar.setAttribute( 'tone', 'success' );
	r.statusEl.textContent = 'Uploaded';
	r.cancelBtn.textContent = 'Dismiss';
	r.lingerTimer = setTimeout( () => dismissRow( r ), 2500 );
	updateHeader();

	activity.publish( 'desktop-mode/upload-hud-complete', {
		filename: fields.filename || result.filename,
		attachmentId: result.id,
	} );
}

function onFailed( file: File, error: Error ): void {
	const r = ROWS.get( file );
	if ( ! r ) {
		return;
	}
	r.bar.removeAttribute( 'indeterminate' );
	r.bar.setAttribute( 'tone', 'danger' );
	r.cancelBtn.textContent = 'Dismiss';
	( r.cancelBtn as unknown as { disabled: boolean } ).disabled = false;
	if ( error.name === 'UploadAbortedError' ) {
		r.state = 'aborted';
		r.statusEl.textContent = 'Cancelled';
	} else {
		r.state = 'failed';
		r.statusEl.textContent = error.message || 'Upload failed';
	}
	updateHeader();
}

function dismissRow( r: HudRow ): void {
	if ( r.lingerTimer ) {
		clearTimeout( r.lingerTimer );
	}
	ROWS.delete( r.file );
	r.root.remove();
	updateHeader();
	if ( ROWS.size === 0 && panel ) {
		panel.hidden = true;
	}
}

function ensurePanel(): HTMLElement {
	if ( panel && panel.isConnected ) {
		panel.hidden = false;
		return panel;
	}
	const p = document.createElement( 'div' );
	p.className = 'desktop-mode-upload-hud';
	p.setAttribute( 'role', 'region' );
	p.setAttribute( 'aria-label', 'Uploads' );

	const header = document.createElement( 'div' );
	header.className = 'desktop-mode-upload-hud__header';

	const title = document.createElement( 'div' );
	title.className = 'desktop-mode-upload-hud__title';
	title.textContent = 'Uploads';

	const closeBtn = document.createElement( 'button' );
	closeBtn.type = 'button';
	closeBtn.className = 'desktop-mode-upload-hud__close';
	closeBtn.setAttribute( 'aria-label', 'Hide upload panel' );
	closeBtn.textContent = '×';
	closeBtn.addEventListener( 'click', () => {
		// Dismiss every finished row, hide the panel. In-flight uploads
		// stay running — the user must click each row's Cancel to abort.
		for ( const r of [ ...ROWS.values() ] ) {
			if ( r.state !== 'running' ) {
				dismissRow( r );
			}
		}
		if ( ROWS.size === 0 ) {
			p.hidden = true;
		}
	} );

	header.append( title, closeBtn );

	const list = document.createElement( 'div' );
	list.className = 'desktop-mode-upload-hud__list';

	p.append( header, list );
	document.body.appendChild( p );
	panel = p;
	return p;
}

function updateHeader(): void {
	if ( ! panel ) {
		return;
	}
	const title = panel.querySelector(
		'.desktop-mode-upload-hud__title',
	) as HTMLElement | null;
	if ( ! title ) {
		return;
	}
	const total = ROWS.size;
	const running = [ ...ROWS.values() ].filter( ( r ) => r.state === 'running' )
		.length;
	if ( running > 0 ) {
		title.textContent =
			running === total
				? `Uploading ${ running } file${ running === 1 ? '' : 's' }…`
				: `${ running } of ${ total } uploading…`;
	} else if ( total > 0 ) {
		title.textContent = `Uploads (${ total })`;
	} else {
		title.textContent = 'Uploads';
	}
}

