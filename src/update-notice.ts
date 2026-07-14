/**
 * Core-update notification — the shell-side half of the update-nag
 * hijack.
 *
 * WordPress core repeats "WordPress X is available!" on every admin
 * screen; the plugin detaches that nag inside every window (PHP) and
 * ships a descriptor in the shell config as `coreUpdate`. This module
 * turns that descriptor into a single notification — one, not one per
 * window — choosing the surface by how big the release is:
 *
 *   - **Major release with art** → the `<wpd-release-card>` vinyl
 *     moment (the release's own album sleeve with the record sliding
 *     out). WordPress ships this art every major.
 *   - **Everything else** (minors, or a major we don't have art for)
 *     → a plain persistent toast.
 *
 * Both are non-dismissible: like core's own nag they stay until the
 * update is addressed. "Update now" opens the update screen and clears
 * the notification; if the user navigates away without updating it
 * returns on the next shell load. Once installed the server stops
 * shipping `coreUpdate`, so nothing appears.
 *
 * @since 0.9.3
 */

import { showToast } from './toast';
import { showReleaseCard } from './release-card';
import { __, sprintf } from './i18n';

/** Release-art descriptor for a major update (from the PHP registry). */
export interface CoreUpdateRelease {
	name: string;
	artUrl: string;
	accent: string;
	accentInk: string;
}

/** Compact core-update descriptor shipped in the shell config. */
export interface CoreUpdateInfo {
	version: string;
	url: string;
	/** New X.Y branch relative to the installed version. */
	major?: boolean;
	/** Release art for a major, when known; `null`/absent otherwise. */
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
 * Show the core-update notification if an update is pending — the vinyl
 * release card for a major with art, the plain toast otherwise. No-op
 * when there's nothing to show.
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

	const openUpdateScreen = (): void =>
		openUrl( { url: update.url, title: __( 'WordPress Updates' ) } );

	// Major release with known art → the album-sleeve vinyl moment.
	const release = update.release;
	if (
		update.major &&
		release &&
		typeof release.artUrl === 'string' &&
		release.artUrl
	) {
		showReleaseCard( {
			version: update.version,
			name: typeof release.name === 'string' ? release.name : '',
			artUrl: release.artUrl,
			// Defaults match the component's classic cream vinyl label;
			// the PHP `desktop_mode_core_update_release` filter can supply
			// a per-release color match.
			accent: typeof release.accent === 'string' ? release.accent : '#efe6d3',
			accentInk:
				typeof release.accentInk === 'string' ? release.accentInk : '#1a1a1a',
			onUpdate: openUpdateScreen,
		} );
		return;
	}

	// Everything else → the plain persistent, non-dismissible toast.
	showToast( {
		/* translators: %s: WordPress version number. */
		message: sprintf( __( 'WordPress %s is available.' ), update.version ),
		persistent: true,
		action: {
			label: __( 'Update now' ),
			onClick: openUpdateScreen,
		},
	} );
}
