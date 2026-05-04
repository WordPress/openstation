/**
 * Code Editor — page-level listeners.
 *
 * Two global handlers that run on every desktop-mode page load
 * (the editor's bundle is enqueued eagerly by
 * `desktop_mode_enqueue_native_window_scripts`), regardless of whether
 * the editor window is currently open:
 *
 *   - **Cmd/Ctrl + Shift + E** keyboard shortcut → open / focus
 *     the editor window.
 *   - **`wp-desktop-code-open` postMessage** → from any frame on
 *     the page, request the editor open at a specific path + line.
 *     Documented for plugin authors so a "View source" link in a
 *     plugin's iframe can deep-link into the editor.
 *
 * Both handlers go through `wp.desktop.openWindow( 'wpdc-editor' )`
 * → the canonical native-window opener that pre-clones the
 * editor's template into the body. Same code path as the dock
 * click; no surprises on first paint.
 *
 * Idempotent: imported once at module-load time, registers with
 * a guard flag so a second import doesn't double-attach.
 *
 * @public
 * @since 0.18.0
 */

const FLAG = '__wpdcEditorListenersInstalled';

interface DesktopApi {
	openWindow: ( id: string ) => boolean;
	windowManager: {
		getById: (
			id: string,
		) => {
			focus?: () => void;
		} | null;
	};
}

function getDesktop(): DesktopApi | null {
	const w = window as unknown as { wp?: { desktop?: unknown } };
	return ( w.wp?.desktop ?? null ) as DesktopApi | null;
}

/**
 * Open or focus the editor window. Public so other in-bundle
 * modules (the open-from-elsewhere postMessage handler below) can
 * reuse the same flow.
 */
export function openEditorWindow(): boolean {
	const desktop = getDesktop();
	if ( ! desktop ) {
		return false;
	}
	const existing = desktop.windowManager.getById( 'wpdc-editor' );
	if ( existing ) {
		existing.focus?.();
		return true;
	}
	return desktop.openWindow( 'wpdc-editor' );
}

/**
 * Open the editor window AND drive it to a specific file/line via
 * a follow-up postMessage to itself. The editor's
 * `wp-desktop-code-open` listener (below) handles the file fetch +
 * scroll. Two-step so callers from outside the editor's bundle
 * don't have to know about the editor's internal openFileAtLine.
 */
function openEditorAtPath( path: string, line: number = 1 ): void {
	openEditorWindow();
	// Re-broadcast to ourselves so the in-window handler takes over
	// once the render callback has mounted the editor.
	const fire = (): void =>
		window.postMessage(
			{ type: 'wp-desktop-code-open', path, line },
			window.location.origin,
		);
	// rAF defers until the next paint — the editor's render callback
	// has had a chance to mount + bind its listener by then.
	requestAnimationFrame( fire );
}

interface OpenEditorMessage {
	type: 'wp-desktop-code-open';
	path: string;
	line?: number;
}

function isOpenEditorMessage( data: unknown ): data is OpenEditorMessage {
	if ( ! data || typeof data !== 'object' ) {
		return false;
	}
	const msg = data as Record< string, unknown >;
	return (
		msg.type === 'wp-desktop-code-open' &&
		typeof msg.path === 'string' &&
		( msg.line === undefined || typeof msg.line === 'number' )
	);
}

/**
 * Listen for cross-frame requests to open a file in the editor.
 * Plugin authors post:
 *
 *     window.parent.postMessage(
 *         { type: 'wp-desktop-code-open', path: 'plugins/foo/foo.php', line: 42 },
 *         window.location.origin
 *     );
 *
 * The shell-level handler (this one) opens the editor + relays the
 * request inward; the in-editor render callback's listener (also
 * subscribed to this message type) catches it and runs
 * `openFileAtLine`.
 */
function installPostMessageListener(): void {
	window.addEventListener( 'message', ( event: MessageEvent ) => {
		// Same-origin only — desktop mode runs on a single origin
		// and we have no need to accept cross-origin opens.
		if ( event.origin !== window.location.origin ) {
			return;
		}
		if ( ! isOpenEditorMessage( event.data ) ) {
			return;
		}
		// Editor not open yet → open it and re-broadcast so the
		// in-editor handler picks it up after mount. Already open
		// → the in-editor handler is already subscribed and will
		// catch this same event itself.
		const desktop = getDesktop();
		const existing = desktop?.windowManager.getById( 'wpdc-editor' );
		if ( ! existing ) {
			openEditorAtPath( event.data.path, event.data.line ?? 1 );
		}
	} );
}

function installKeyboardShortcut(): void {
	window.addEventListener(
		'keydown',
		( e: KeyboardEvent ) => {
			// Cmd/Ctrl + Shift + E. Use `key` rather than `code` so
			// Dvorak / non-QWERT layouts hit the same letter the user
			// sees on their keycap.
			if (
				( e.metaKey || e.ctrlKey ) &&
				e.shiftKey &&
				! e.altKey &&
				e.key.toLowerCase() === 'e'
			) {
				// Don't intercept if focus is in a contenteditable —
				// user might want a real Cmd-Shift-E for a different
				// app. Monaco is fine; it doesn't bind that combo.
				const target = e.target as HTMLElement | null;
				if (
					target?.isContentEditable &&
					! target.closest( '[data-wpdc-editor-root]' )
				) {
					return;
				}
				e.preventDefault();
				openEditorWindow();
			}
		},
		// Capture so wp-admin's own keydown handlers don't swallow
		// the shortcut before we see it.
		{ capture: true },
	);
}

/** Install both listeners exactly once per page. */
export function installEditorGlobalListeners(): void {
	const w = window as unknown as Record< string, unknown >;
	if ( w[ FLAG ] ) {
		return;
	}
	w[ FLAG ] = true;
	installKeyboardShortcut();
	installPostMessageListener();
}
