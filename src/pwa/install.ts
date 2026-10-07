import { __, sprintf } from '../i18n';
import type { ToastOptions } from '../toast';
import { getSwRegistrationStatus } from './sw-register';

export const PWA_INSTALL_TILE_ID = 'os-pwa-install';

interface BeforeInstallPromptEvent extends Event {
	readonly platforms: string[];
	prompt: () => Promise< void >;
	userChoice: Promise< { outcome: 'accepted' | 'dismissed' } >;
}

export function isStandaloneDisplay(): boolean {
	if ( typeof window === 'undefined' ) {
		return false;
	}
	if ( window.matchMedia?.( '(display-mode: standalone)' ).matches ) {
		return true;
	}

	const nav = window.navigator as unknown as { standalone?: boolean };
	return nav.standalone === true;
}

export async function isLikelyInstalled(): Promise< boolean > {
	if ( isStandaloneDisplay() ) {
		return true;
	}
	const nav = window.navigator as unknown as {
		getInstalledRelatedApps?: () => Promise<
			Array< { platform?: string; url?: string; id?: string } >
		>;
	};
	if ( typeof nav.getInstalledRelatedApps !== 'function' ) {
		return false;
	}
	try {
		const apps = await nav.getInstalledRelatedApps();
		return Array.isArray( apps ) && apps.length > 0;
	} catch {
		return false;
	}
}

let _deferred: BeforeInstallPromptEvent | null = null;

export function installPwaInstallAffordance(
	siteName: string,
	showToast: ( opts: ToastOptions ) => () => void,
): void {
	if ( typeof window === 'undefined' ) {
		return;
	}

	window.removeEventListener(
		'beforeinstallprompt',
		_handleBeforeInstall as EventListener,
	);
	window.addEventListener(
		'beforeinstallprompt',
		_handleBeforeInstall as EventListener,
	);

	window.removeEventListener( 'appinstalled', _handleAppInstalled );
	window.addEventListener( 'appinstalled', _handleAppInstalled );

	function _handleBeforeInstall( ev: Event ): void {
		ev.preventDefault();
		_deferred = ev as BeforeInstallPromptEvent;
	}

	function _handleAppInstalled(): void {
		_deferred = null;

		showToast( {
			message: sprintf(

				__( 'Installed %s as an app.' ),
				siteName,
			),
		} );
	}
}

export function getInstallTileDef(
	siteName: string,
	showToast: ( opts: ToastOptions ) => () => void,
): {
	id: string;
	title: string;
	icon: string;
	onOpen: () => void;
} {
	return {
		id: PWA_INSTALL_TILE_ID,

		title: __( 'Install web app' ),

		icon: 'dashicons-download',
		onOpen: () => {
			void onTileClick( siteName, showToast );
		},
	};
}

async function onTileClick(
	siteName: string,
	showToast: ( opts: ToastOptions ) => () => void,
): Promise< void > {
	if ( _deferred ) {
		const event = _deferred;

		_deferred = null;
		try {
			await event.prompt();
			const choice = await event.userChoice;
			if ( choice.outcome === 'dismissed' ) {
				showToast( {
					message: __( 'Install cancelled.' ),
				} );
			}
		} catch ( err ) {
			if ( typeof console !== 'undefined' ) {
				console.warn(
					'[openstation] install prompt failed:',
					err,
				);
			}
		}
		return;
	}

	if ( await isLikelyInstalled() ) {
		showToast( {
			message: sprintf(

				__(
					'%s is already installed. Open it from your apps menu or home screen.',
				),
				siteName,
			),
		} );
		return;
	}

	if ( getSwRegistrationStatus() === 'foreign-sw' ) {
		showToast( {
			message: __(
				"Install isn't available — another plugin's service worker is active on this site. A site admin can opt in by setting the openstation_pwa_force_replace_sw filter to true.",
			),
		} );
		return;
	}

	showToast( {
		message: __(
			"Install isn't available right now. Keep using the page; if it still doesn't appear, the app may already be installed in this browser.",
		),
	} );
}

export async function promptInstall(): Promise<
	'accepted' | 'dismissed' | 'unavailable'
	> {
	if ( ! _deferred ) {
		return 'unavailable';
	}
	const event = _deferred;
	_deferred = null;
	try {
		await event.prompt();
		const choice = await event.userChoice;
		return choice.outcome;
	} catch {
		return 'unavailable';
	}
}

export function undismissInstallHint(): void {
	import( './state' ).then( ( m ) => {
		m.updatePwaState( { installHintDismissed: false } );
	} );
}

export function _resetInstallAffordance(): void {
	_deferred = null;
}
