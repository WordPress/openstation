/**
 * Core-update notification — the shell-side half of the update-nag
 * hijack.
 *
 * The server reports *that* a core update is pending (`config.coreUpdate`
 * = `{ version, branch, url, crossing }`); this module resolves the
 * release art client-side and surfaces a single notification — one, not
 * one per window:
 *
 *   - **Art resolves** → the `<wpd-release-card>` vinyl moment (the
 *     release's album sleeve with the record sliding out). We wait for
 *     the art to load first, so it appears once, already painted — no
 *     temporary toast.
 *   - **No art** (unknown release / offline) → a plain persistent toast.
 *
 * Wording follows the descriptor: crossing into a new major shows the
 * branch version + codename ("WordPress 7.0 'Armstrong' is available");
 * a same-branch minor shows the exact version, no codename.
 *
 * Both are non-dismissible via auto-timeout; the vinyl has a close button
 * whose dismissal is persisted (per branch), and a dismissed release is
 * skipped here.
 *
 * @since 0.9.3
 */

import { showToast } from './toast';
import { showReleaseCard } from './release-card';
import {
	resolveReleaseArt,
	preloadImage,
	type ReleaseArt,
} from './release-art';
import { isNoticeDismissed } from './ui/components/wpd-notice/storage';
import { __, sprintf } from './i18n';

/** Compact core-update descriptor shipped in the shell config. */
export interface CoreUpdateInfo {
	/** Message version — major branch when crossing, else exact version. */
	version: string;
	/** Major branch (e.g. `7.0`) — the art + dismissal key. */
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
	const dismissKey = `desktop-mode/core-update:${ branch }`;
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
			version,
			name: crossing ? art.name : '',
			artUrl: art.artUrl,
			dismissKey,
			onUpdate: openUpdateScreen,
		} );
		return;
	}

	// No art (unknown release / offline / image failed) → plain toast.
	showToast( {
		message: updateMessage( version, '' ),
		persistent: true,
		action: {
			label: __( 'Update now' ),
			onClick: openUpdateScreen,
		},
	} );
}
