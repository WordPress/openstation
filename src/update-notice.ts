/**
 * Turns the server's `coreUpdate` into a single shell notification:
 * resolves the release art (async) and shows the vinyl release card once
 * it's loaded, or a plain toast when no art is available.
 *
 * @since 0.9.4
 */

import { showToast } from './toast';
import { showReleaseCard } from './release-card';
import {
	resolveReleaseArt,
	preloadImage,
	type ReleaseArt,
} from './release-art';
import {
	isNoticeDismissed,
	markNoticeDismissed,
} from './ui/components/wpd-notice/storage';
import { __, sprintf } from './i18n';

/** Compact core-update descriptor shipped in the shell config. */
export interface CoreUpdateInfo {
	/** Message version — major branch when crossing, else exact version. */
	version: string;
	/** Exact available version — the dismissal key (a newer point release re-notifies). */
	available?: string;
	/** Major branch (e.g. `7.0`) — the art key. */
	branch?: string;
	url: string;
	/** True when moving into a new major (→ show the codename). */
	crossing?: boolean;
}

/** Dependencies the notification needs from the shell (art/preload injectable for tests). */
export interface UpdateNoticeDeps {
	/** The `config.coreUpdate` value (may be absent / null). */
	update: CoreUpdateInfo | null | undefined;
	/** Open an admin URL as a window (the "Update now" action). */
	openUrl: ( args: { url: string; title: string } ) => void;
	/** Resolve release art for a branch. Defaults to the news-feed resolver. */
	resolveArt?: ( branch: string ) => Promise< ReleaseArt | null >;
	/** Preload an image, resolving true when ready. Defaults to the real preloader. */
	loadImage?: ( url: string ) => Promise< boolean >;
}

/**
 * "WordPress X is available." — with the codename when one is present
 * ("WordPress 7.0 "Armstrong" is available.").
 */
export function updateMessage( version: string, name: string ): string {
	if ( name ) {
		/* translators: 1: WordPress version, 2: release codename. */
		const withName = __( 'WordPress %1$s "%2$s" is available.' );
		return sprintf( withName, version, name );
	}
	/* translators: %s: WordPress version. */
	const versionOnly = __( 'WordPress %s is available.' );
	return sprintf( versionOnly, version );
}

/**
 * Show the core-update notification if an update is pending — the vinyl
 * release card once its art is fetched + loaded, the plain toast if no
 * art is available. No-op when there's nothing to show or the release
 * was already dismissed.
 */
export async function maybeShowUpdate( deps: UpdateNoticeDeps ): Promise< void > {
	const { update, openUrl } = deps;
	if (
		! update ||
		typeof update.version !== 'string' ||
		! update.version ||
		typeof update.url !== 'string' ||
		! update.url
	) {
		return;
	}

	const version = update.version;
	const branch =
		typeof update.branch === 'string' && update.branch
			? update.branch
			: version;
	const crossing = update.crossing === true;
	// Key dismissal on the exact available version, so dismissing 7.0.1
	// doesn't also hide a later 7.0.2 (a newer release is a new notice).
	const exact =
		typeof update.available === 'string' && update.available
			? update.available
			: version;
	const dismissKey = `desktop-mode/core-update:${ exact }`;
	if ( isNoticeDismissed( dismissKey ) ) {
		return;
	}

	const openUpdateScreen = (): void =>
		openUrl( { url: update.url, title: __( 'WordPress Updates' ) } );

	const resolveArt = deps.resolveArt ?? resolveReleaseArt;
	const load = deps.loadImage ?? preloadImage;

	// Resolve + preload the art before showing anything, so the vinyl
	// appears once (already painted) instead of flashing a toast first.
	const art = await resolveArt( branch );
	if ( art && art.artUrl && ( await load( art.artUrl ) ) ) {
		showReleaseCard( {
			message: updateMessage( version, crossing ? art.name : '' ),
			artUrl: art.artUrl,
			dismissKey,
			onUpdate: openUpdateScreen,
		} );
		return;
	}

	// No art (unknown release / offline / image failed) → plain toast.
	// Dismissible + persisted on the same key as the card, so closing it
	// keeps it closed for this exact version.
	showToast( {
		message: updateMessage( version, '' ),
		persistent: true,
		dismissible: true,
		onDismiss: () => markNoticeDismissed( dismissKey ),
		action: {
			label: __( 'Update now' ),
			onClick: openUpdateScreen,
		},
	} );
}
