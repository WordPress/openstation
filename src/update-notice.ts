/**
 * Core-update notification — the shell-side half of the update-nag
 * hijack.
 *
 * WordPress core repeats "WordPress X is available!" on every admin
 * screen; the plugin detaches that nag inside every window (PHP) and
 * ships a descriptor in the shell config as `coreUpdate`. This module
 * turns that descriptor into a single notification — one, not one per
 * window:
 *
 *   - **Branch has release art** → the `<wpd-release-card>` vinyl moment
 *     (the release's album sleeve with the record sliding out). Shown
 *     for any update in that branch, including a minor (the minor reuses
 *     its major's art).
 *   - **No art** → a plain persistent toast.
 *
 * The message wording comes straight from the descriptor: crossing into
 * a new major shows the branch version + codename ("WordPress 7.0
 * 'Armstrong' is available"); a same-branch minor shows the exact
 * version with no codename ("WordPress 7.0.1 is available").
 *
 * Both are non-dismissible: like core's own nag they stay until the
 * update is addressed. "Update now" opens the update screen and clears
 * the notification; once installed the server stops shipping
 * `coreUpdate`, so nothing appears.
 *
 * @since 0.9.3
 */

import { showToast } from './toast';
import { showReleaseCard } from './release-card';
import { __, sprintf } from './i18n';

/** Release-art descriptor for a branch (from the PHP resolver). */
export interface CoreUpdateRelease {
	artUrl: string;
	/** Optional accent override; otherwise derived from the art. */
	accent?: string;
	accentInk?: string;
}

/** Compact core-update descriptor shipped in the shell config. */
export interface CoreUpdateInfo {
	/** Message version — major branch when crossing, else exact version. */
	version: string;
	/** Release codename — shown only when crossing into a new major. */
	name?: string;
	/** Major branch (e.g. `7.0`) — the record label. */
	branch?: string;
	url: string;
	/** Branch album art, or null/absent → plain toast. */
	release?: CoreUpdateRelease | null;
}

/** Dependencies the notification needs from the shell. */
export interface UpdateNoticeDeps {
	/** The `config.coreUpdate` value (may be absent / null). */
	update: CoreUpdateInfo | null | undefined;
	/** Open an admin URL as a window (the "Update now" action). */
	openUrl: ( args: { url: string; title: string } ) => void;
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
 * release card when the branch has art, the plain toast otherwise.
 */
export function maybeShowUpdate( deps: UpdateNoticeDeps ): void {
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

	const name = typeof update.name === 'string' ? update.name : '';
	const openUpdateScreen = (): void =>
		openUrl( { url: update.url, title: __( 'WordPress Updates' ) } );

	// Branch art available → the album-sleeve vinyl moment (major or
	// minor within a branch that has art).
	const release = update.release;
	if ( release && typeof release.artUrl === 'string' && release.artUrl ) {
		showReleaseCard( {
			version: update.version,
			name,
			branch:
				typeof update.branch === 'string' && update.branch
					? update.branch
					: update.version,
			artUrl: release.artUrl,
			accent: typeof release.accent === 'string' ? release.accent : undefined,
			accentInk:
				typeof release.accentInk === 'string' ? release.accentInk : undefined,
			onUpdate: openUpdateScreen,
		} );
		return;
	}

	// No art → the plain persistent, non-dismissible toast.
	showToast( {
		message: updateMessage( update.version, name ),
		persistent: true,
		action: {
			label: __( 'Update now' ),
			onClick: openUpdateScreen,
		},
	} );
}
