/**
 * Desktop Mode — File-open dispatcher.
 *
 * Glue between {@link resolveOpener} and the shell's window
 * manager / native-window registry. Dependencies (the manager,
 * the native-window opener) are injected at boot via
 * {@link installOpenDeps} so the opener module stays free of a
 * direct import on `desktop.ts` (which would create a cycle).
 *
 * @since 0.9.0
 */

import { doAction } from '../hooks';
import { resolveOpener, type OpenerContext } from './openers';
import type { DesktopFile } from './file';

export interface OpenDeps {
	/** Open a chromeless iframe window at `url`. Returns true on open/focus. */
	openUrl: ( args: { id: string; url: string; title: string; icon: string } ) => boolean;
	/** Open a registered native window by id, optionally with a per-call config. */
	openNativeWindow: ( id: string, config?: unknown ) => boolean;
	/** Build a stable window id from a URL — mirrors `wp.desktop.deriveWindowId`. */
	deriveWindowId: ( url: string ) => string;
}

let deps: OpenDeps | null = null;

/** Install dependencies. Called once from `desktop.ts` after the shell mounts. */
export function installOpenDeps( next: OpenDeps ): void {
	deps = next;
}

/**
 * Open a desktop file using the resolved opener. Returns `true`
 * when something opened, `false` when no opener could handle the
 * file (caller may surface a "no app" toast).
 */
export async function openFile(
	file: DesktopFile,
	ctx?: OpenerContext,
): Promise< boolean > {
	if ( ! deps ) {
		// eslint-disable-next-line no-console
		console.warn(
			'[desktop-mode] wp.desktop.files.open() called before the shell installed open deps. The file will not open.',
		);
		return false;
	}

	const opener = resolveOpener( file.type() );
	if ( ! opener ) {
		doAction( 'desktop-mode.files.open-failed', {
			reason: 'no-opener',
			type: file.type(),
			ref: file.ref(),
		} );
		return false;
	}

	doAction( 'desktop-mode.files.opening', { file, openerId: opener.id } );

	try {
		const handler = opener.handler;
		if ( handler.kind === 'url' ) {
			const url = await handler.url( file );
			if ( ! url ) {
				return false;
			}
			const id = handler.windowId
				? handler.windowId( file )
				: deps.deriveWindowId( url );
			const title = handler.title ? handler.title( file ) : file.title();
			const icon = file.icon();
			const opened = deps.openUrl( { id, url, title, icon } );
			doAction( 'desktop-mode.files.opened', { file, openerId: opener.id, kind: 'url' } );
			return opened;
		}
		if ( handler.kind === 'window' ) {
			const config = handler.config ? handler.config( file ) : undefined;
			const opened = deps.openNativeWindow( handler.windowId, config );
			doAction( 'desktop-mode.files.opened', { file, openerId: opener.id, kind: 'window' } );
			return opened;
		}
		// 'js'.
		await handler.open( file, ctx );
		doAction( 'desktop-mode.files.opened', { file, openerId: opener.id, kind: 'js' } );
		return true;
	} catch ( err ) {
		doAction( 'desktop-mode.files.open-failed', {
			reason: 'handler-threw',
			type: file.type(),
			ref: file.ref(),
			openerId: opener.id,
			error: err,
		} );
		// eslint-disable-next-line no-console
		console.error( '[desktop-mode] file opener threw:', err );
		return false;
	}
}
