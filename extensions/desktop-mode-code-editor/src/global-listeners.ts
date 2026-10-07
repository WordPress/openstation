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
	const w = window as unknown as { wp?: { os?: unknown } };
	return ( w.wp?.os ?? null ) as DesktopApi | null;
}

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

function openEditorAtPath( path: string, line: number = 1 ): void {
	openEditorWindow();

	const fire = (): void =>
		window.postMessage(
			{ type: 'os-code-open', path, line },
			window.location.origin,
		);

	requestAnimationFrame( fire );
}

interface OpenEditorMessage {
	type: 'os-code-open';
	path: string;
	line?: number;
}

function isOpenEditorMessage( data: unknown ): data is OpenEditorMessage {
	if ( ! data || typeof data !== 'object' ) {
		return false;
	}
	const msg = data as Record< string, unknown >;
	return (
		msg.type === 'os-code-open' &&
		typeof msg.path === 'string' &&
		( msg.line === undefined || typeof msg.line === 'number' )
	);
}

function installPostMessageListener(): void {
	window.addEventListener( 'message', ( event: MessageEvent ) => {

		if ( event.origin !== window.location.origin ) {
			return;
		}
		if ( ! isOpenEditorMessage( event.data ) ) {
			return;
		}

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

			if (
				( e.metaKey || e.ctrlKey ) &&
				e.shiftKey &&
				! e.altKey &&
				e.key.toLowerCase() === 'e'
			) {

				const target = e.target as HTMLElement | null;
				if (
					target?.isContentEditable &&
					! target.closest( '[data-osc-editor-root]' )
				) {
					return;
				}
				e.preventDefault();
				openEditorWindow();
			}
		},

		{ capture: true },
	);
}

export function installEditorGlobalListeners(): void {
	const w = window as unknown as Record< string, unknown >;
	if ( w[ FLAG ] ) {
		return;
	}
	w[ FLAG ] = true;
	installKeyboardShortcut();
	installPostMessageListener();
}
