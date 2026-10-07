import { activity } from './activity';
import type { DesktopConfig, ToastTypeDef } from './types';
import { openWithShellOverlays } from './shell-overlays/loader';

const DEFAULT_DURATION_MS = 4000;

const FADE_OUT_MS = 200;

const MIN_RESUME_MS = 1200;

export interface ToastOptions {

	message: string;

	type?: string;

	action?: {
		label: string;
		onClick: () => void;
	};

	duration?: number;

	persistent?: boolean;

	dismissible?: boolean;

	onDismiss?: () => void;
}

export interface ToastIntent extends ToastOptions {

	source?: string;

	meta?: Record< string, unknown >;

	cancel?: boolean;
}

export function showToast( options: ToastOptions ): () => void {
	const intent: ToastIntent = activity.filter(
		'os/toast-requested',
		{ ...options },
	) as ToastIntent;
	if ( ! intent || intent.cancel === true ) {
		return () => undefined;
	}

	let dismissRequested = false;
	let realDismiss: ( () => void ) | null = null;

	openWithShellOverlays(
		() => ! dismissRequested,
		() => {
			realDismiss = renderToast( intent );
		},
	);

	return () => {
		dismissRequested = true;
		if ( realDismiss ) {
			realDismiss();
		}
	};
}

type ToastTone = ToastTypeDef[ 'tone' ];

const BUILT_IN_TONES: Record< string, ToastTone > = {
	success: 'positive',
	warning: 'warning',
	error: 'critical',
	'shell-error': 'critical',
};

function toastTone( type: string | undefined ): ToastTone | null {
	if ( ! type ) {
		return null;
	}
	const registry = (
		window as unknown as { openStationConfig?: DesktopConfig }
	).openStationConfig?.toastTypes;
	const entry = registry?.find( ( t ) => t.id === type );
	return entry?.tone ?? BUILT_IN_TONES[ type ] ?? null;
}

function renderToast( intent: ToastIntent ): () => void {
	const container = ensureContainer();
	const toast = document.createElement( 'os-toast' );
	toast.textContent = intent.message;

	const tone = toastTone( intent.type );
	if ( tone ) {
		toast.setAttribute( 'tone', tone );
	}

	if ( intent.action ) {
		toast.setAttribute( 'action', intent.action.label );
		toast.addEventListener( 'os-toast-action', () => {
			intent.action?.onClick();
			dismiss();
		} );
	}

	if ( intent.dismissible ) {
		toast.setAttribute( 'dismissible', '' );
		toast.addEventListener( 'os-toast-dismiss', () => {
			intent.onDismiss?.();
			dismiss();
		} );
	}

	container.appendChild( toast );

	let dismissed = false;
	let dismissTimer: number | null = null;

	let remaining = intent.duration ?? DEFAULT_DURATION_MS;

	let startedAt = 0;

	const stopTimer = (): void => {
		if ( dismissTimer === null ) {
			return;
		}
		window.clearTimeout( dismissTimer );
		dismissTimer = null;
	};

	const dismiss = (): void => {
		if ( dismissed ) {
			return;
		}
		dismissed = true;
		stopTimer();

		restoreFocusFrom( toast );
		toast.setAttribute( 'state', 'out' );
		window.setTimeout( () => {
			toast.remove();
			releaseFocusTracking();
		}, FADE_OUT_MS );
	};

	const startTimer = (): void => {
		if ( dismissed || intent.persistent || dismissTimer !== null ) {
			return;
		}
		startedAt = Date.now();
		dismissTimer = window.setTimeout(
			dismiss,
			remaining,
		) as unknown as number;
	};

	const pauseTimer = (): void => {
		if ( dismissTimer === null ) {
			return;
		}
		remaining = Math.max( 0, remaining - ( Date.now() - startedAt ) );
		stopTimer();
	};

	requestAnimationFrame( () => {
		toast.setAttribute( 'state', 'in' );
	} );

	toast.addEventListener( 'os-toast-hold', ( e: Event ) => {
		const held = ( e as CustomEvent< { held: boolean } > ).detail?.held;
		if ( held ) {
			pauseTimer();
			return;
		}
		remaining = Math.max( remaining, MIN_RESUME_MS );
		startTimer();
	} );

	trackExternalFocus( toast );
	startTimer();

	activity.publish( 'os/toast-shown', { ...intent } );

	return dismiss;
}

let lastExternalFocus: HTMLElement | null = null;

let focusTrackers = 0;

function onDocumentFocusIn( e: FocusEvent ): void {
	const target = e.target;
	if ( ! ( target instanceof HTMLElement ) ) {
		return;
	}
	if ( target.closest( 'os-toast-container' ) ) {
		return;
	}
	lastExternalFocus = target;
}

function trackExternalFocus( toast: HTMLElement ): void {
	if ( focusTrackers === 0 ) {
		document.addEventListener( 'focusin', onDocumentFocusIn, true );
	}
	focusTrackers += 1;

	const doc = toast.ownerDocument;
	const active = doc.activeElement;
	if (
		active instanceof HTMLElement &&
		active !== doc.body &&
		! active.closest( 'os-toast-container' )
	) {
		lastExternalFocus = active;
	}
}

function releaseFocusTracking(): void {
	focusTrackers = Math.max( 0, focusTrackers - 1 );
	if ( focusTrackers === 0 ) {
		document.removeEventListener( 'focusin', onDocumentFocusIn, true );
	}
}

function restoreFocusFrom( toast: HTMLElement ): void {
	const active = toast.ownerDocument.activeElement;
	if ( active !== toast && ! toast.contains( active ) ) {
		return;
	}
	if ( lastExternalFocus?.isConnected === true ) {
		lastExternalFocus.focus();
	}
}

function ensureContainer(): HTMLElement {
	const existing = document.querySelector<HTMLElement>(
		'os-toast-container',
	);
	if ( existing ) {
		return existing;
	}
	const el = document.createElement( 'os-toast-container' );
	document.body.appendChild( el );
	return el;
}
