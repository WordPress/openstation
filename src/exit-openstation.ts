import type { SystemDockItem } from './dock';
import { SYSTEM_TILE_ORDER } from './dock-shell-tiles';
import type { ShortcutsData } from './shortcuts';
import { __ } from './i18n';

export const EXIT_OPENSTATION_TILE_ID = 'os-exit';

interface AdminBarConfig {
	nonce?: string;
	classicUrl?: string;
	ajaxUrl?: string;

	network?: boolean;

	shortcuts?: ShortcutsData;
}

declare global {
	interface Window {
		openStationAdminBar?: AdminBarConfig;
	}
}

export function getExitOpenStationTileDef(): SystemDockItem {
	return {
		id: EXIT_OPENSTATION_TILE_ID,
		title: __( 'Exit OpenStation' ),
		navKind: 'control',

		locked: true,

		order: SYSTEM_TILE_ORDER.exit,

		icon: 'dashicons-exit',
		onOpen: () => {
			void exitOpenStation();
		},
	};
}

export async function exitOpenStation(): Promise< void > {
	const cfg = window.openStationAdminBar;
	const fallback = cfg?.classicUrl || '/wp-admin/';

	if ( ! cfg?.ajaxUrl || ! cfg?.nonce ) {
		navigateTop( fallback );
		return;
	}

	const body = new URLSearchParams();
	body.set( 'action', 'save-openstation' );
	body.set( 'nonce', cfg.nonce );
	body.set( 'enabled', '' );
	if ( cfg.network ) {
		body.set( 'network', '1' );
	}

	let target = fallback;
	try {
		const res = await fetch( cfg.ajaxUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
			},
			body: body.toString(),
			credentials: 'same-origin',
		} );
		if ( res.ok ) {
			const json = ( await res.json() ) as
				| { success?: boolean; data?: { redirect?: string } }
				| null;
			if ( json?.success && json.data?.redirect ) {
				target = json.data.redirect;
			}
		}
	} catch {

	}

	navigateTop( target );
}

function navigateTop( url: string ): void {
	try {
		( window.top ?? window ).location.assign( url );
	} catch {
		window.location.assign( url );
	}
}

export const LEAVE_DELAY_MS = 800;

export function leaveForClassicAdmin(
	adminUrl: string,
	delayMs: number = LEAVE_DELAY_MS,
): void {
	window.setTimeout( () => {
		if ( adminUrl ) {
			navigateTop( adminUrl );
			return;
		}

		try {
			( window.top ?? window ).location.reload();
		} catch {
			window.location.reload();
		}
	}, delayMs );
}
