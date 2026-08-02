/**
 * OS Settings → Themes.
 *
 * A card grid of every desktop theme in the site's library, plus
 * "System default". Picking is per-user and open to everyone; the
 * upload tile and the per-card delete button appear only for users
 * who hold the theme-management capability
 * (`canManageDesktopThemes`).
 *
 * Code-registered themes (`source: 'code'`) never get a delete
 * button: there is no file to remove and the REST route rightly
 * 404s on them, so offering the control would only ever produce an
 * error. A plugin that ships a theme takes it away by unregistering
 * it — see the built-in "Legacy" theme.
 */

import { __, sprintf } from '../../i18n';
import { html, render } from '../../ui/core';
import { wpdConfirm } from '../../ui/components/wpd-confirm-dialog/wpd-confirm-dialog';
import {
	listDesktopThemes,
	removeDesktopTheme,
	subscribeDesktopThemes,
	upsertDesktopTheme,
} from '../../desktop-themes/registry';
import type { DesktopThemeEntry } from '../../desktop-themes/types';
import {
	deleteDesktopTheme,
	uploadDesktopTheme,
} from '../desktop-themes-api';
import {
	applyThemeRecommendations,
	hasApplicableThemeRecommendations,
} from '../theme-recommendations';
import type { SettingsCtx } from '../types';

/** Sentinel card id for "no theme". */
const SYSTEM_DEFAULT = '';

/**
 * Initials shown on a theme card that ships no preview image.
 * Same idea as the letter-badge icon fallback: something
 * recognisable and stable beats an empty rectangle.
 */
function initialsFor( name: string ): string {
	const words = name.trim().split( /\s+/ ).filter( Boolean );
	if ( words.length === 0 ) {
		return '?';
	}
	if ( words.length >= 2 ) {
		return ( words[ 0 ][ 0 ] + words[ 1 ][ 0 ] ).toUpperCase();
	}
	return words[ 0 ].slice( 0, 2 ).toUpperCase();
}

export function buildThemesSection( ctx: SettingsCtx ): HTMLElement {
	const host = document.createElement( 'div' );
	host.className = 'desktop-mode-os-settings__themes';

	/** Last error surfaced by an upload or delete, if any. */
	let errorText = '';
	/** True while an upload is in flight — disables the tile. */
	let busy = false;

	const canManage = !! ctx.config.canManageDesktopThemes;

	const pick = ( id: string ): void => {
		if ( ctx.state.desktopTheme === id ) {
			return;
		}
		ctx.state.desktopTheme = id;
		// First activation only. `applyThemeRecommendations` no-ops for
		// a theme this user has already worn, which is what stops a
		// theme from ever undoing a preference the user set afterwards.
		applyThemeRecommendations( ctx.state, id );
		ctx.save();
		// `apply()` calls `applyDesktopTheme()`, which swaps the
		// stylesheet, flips the shell attribute + body class, and
		// fires the change event the shell listens on to repaint
		// every themed icon. One call covers the whole switch.
		ctx.apply();
		paint();
	};

	/**
	 * "Apply recommended layout and effects" — the deliberate way back
	 * to the author's intended presentation after the user has moved
	 * things around. The only path that re-applies a recommendation.
	 *
	 * "and effects" is not decoration: a theme may recommend the
	 * window-reveal style and its speed alongside the layout keys, and
	 * a label that named only the layout would understate what the
	 * button is about to change.
	 *
	 * It just sets the settings. The dock resizing and the layout
	 * moving IS the feedback; a notice on top of a visible change is
	 * noise.
	 */
	const applyRecommended = ( theme: DesktopThemeEntry ): void => {
		const applied = applyThemeRecommendations( ctx.state, theme.slug, {
			force: true,
		} );
		if ( Object.keys( applied ).length === 0 ) {
			return;
		}
		ctx.save();
		ctx.apply();
		paint();
	};

	const doUpload = async ( file: File ): Promise< void > => {
		if ( busy ) {
			return;
		}
		busy = true;
		errorText = '';
		paint();
		try {
			const entry = await uploadDesktopTheme( ctx.config, file );
			// Insert directly rather than waiting for the next payload
			// refresh — the theme the admin just uploaded should be
			// pickable the moment the spinner stops.
			upsertDesktopTheme( entry );
		} catch ( err ) {
			errorText =
				err instanceof Error ? err.message : __( 'That theme could not be installed.' );
		} finally {
			busy = false;
			paint();
		}
	};

	const doDelete = async ( theme: DesktopThemeEntry ): Promise< void > => {
		const ok = await wpdConfirm( {
			title: __( 'Delete this theme?' ),
			message: sprintf(
				/* translators: %s: theme name. */
				__( '“%s” will be removed from this site for everyone. This cannot be undone.' ),
				theme.name,
			),
			confirmLabel: __( 'Delete' ),
			danger: true,
		} );
		if ( ! ok ) {
			return;
		}
		errorText = '';
		try {
			await deleteDesktopTheme( ctx.config, theme.slug );
			removeDesktopTheme( theme.slug );
			// Deleting the theme THIS user is wearing has to reset
			// their selection too, or the shell would keep a
			// stylesheet whose file no longer exists until reload.
			// Other users are handled server-side: the enqueue path
			// existence-checks on every request.
			if ( ctx.state.desktopTheme === theme.slug ) {
				ctx.state.desktopTheme = SYSTEM_DEFAULT;
				ctx.save();
				ctx.apply();
			}
		} catch ( err ) {
			errorText =
				err instanceof Error ? err.message : __( 'That theme could not be deleted.' );
		}
		paint();
	};

	const onFileInput = ( e: Event ): void => {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[ 0 ];
		if ( file ) {
			void doUpload( file );
		}
		// Clear so re-picking the same file fires `change` again.
		input.value = '';
	};

	const onDrop = ( e: DragEvent ): void => {
		e.preventDefault();
		( e.currentTarget as HTMLElement ).classList.remove(
			'desktop-mode-os-settings__theme-upload--dragover',
		);
		const file = e.dataTransfer?.files?.[ 0 ];
		if ( file ) {
			void doUpload( file );
		}
	};

	const themeCard = ( theme: DesktopThemeEntry ) => {
		const selected = ctx.state.desktopTheme === theme.slug;
		return html`<div class="desktop-mode-os-settings__theme-card-wrap">
			<button
				type="button"
				class="desktop-mode-os-settings__theme-card"
				role="radio"
				aria-checked=${ selected ? 'true' : 'false' }
				aria-pressed=${ selected ? 'true' : 'false' }
				data-theme-slug=${ theme.slug }
				@click=${ () => pick( theme.slug ) }
			>
				<span class="desktop-mode-os-settings__theme-preview">
					${ theme.previewUrl
						? html`<img
								src=${ theme.previewUrl }
								alt=""
								aria-hidden="true"
								draggable="false"
							/>`
						: html`<span
								class="desktop-mode-os-settings__theme-initials"
								aria-hidden="true"
								>${ initialsFor( theme.name ) }</span
							>` }
				</span>
				<span class="desktop-mode-os-settings__theme-name"
					>${ theme.name }</span
				>
				<span class="desktop-mode-os-settings__theme-meta">
					${ theme.version !== ''
						? sprintf(
							/* translators: %s: theme version string. */
							__( 'Version %s' ),
							theme.version,
						)
						: '' }
				</span>
			</button>
			${ canManage && theme.source !== 'code'
				? html`<button
						type="button"
						class="desktop-mode-os-settings__theme-delete"
						aria-label=${ sprintf(
							/* translators: %s: theme name. */
							__( 'Delete %s' ),
							theme.name,
						) }
						@click=${ () => void doDelete( theme ) }
					>
						×
					</button>`
				: '' }
		</div>`;
	};

	const systemCard = () => {
		const selected = ctx.state.desktopTheme === SYSTEM_DEFAULT;
		return html`<div class="desktop-mode-os-settings__theme-card-wrap">
			<button
				type="button"
				class="desktop-mode-os-settings__theme-card desktop-mode-os-settings__theme-card--system"
				role="radio"
				aria-checked=${ selected ? 'true' : 'false' }
				aria-pressed=${ selected ? 'true' : 'false' }
				@click=${ () => pick( SYSTEM_DEFAULT ) }
			>
				<span
					class="desktop-mode-os-settings__theme-preview desktop-mode-os-settings__theme-preview--system"
					aria-hidden="true"
				></span>
				<span class="desktop-mode-os-settings__theme-name"
					>${ __( 'System default' ) }</span
				>
				<span class="desktop-mode-os-settings__theme-meta"
					>${ __( 'The look Desktop Mode ships with' ) }</span
				>
			</button>
		</div>`;
	};

	const uploadTile = () => html`<div
		class=${ busy
			? 'desktop-mode-os-settings__theme-upload desktop-mode-os-settings__theme-upload--busy'
			: 'desktop-mode-os-settings__theme-upload' }
		@dragover=${ ( e: DragEvent ) => {
			e.preventDefault();
			( e.currentTarget as HTMLElement ).classList.add(
				'desktop-mode-os-settings__theme-upload--dragover',
			);
		} }
		@dragleave=${ ( e: DragEvent ) => {
			( e.currentTarget as HTMLElement ).classList.remove(
				'desktop-mode-os-settings__theme-upload--dragover',
			);
		} }
		@drop=${ onDrop }
	>
		<label class="desktop-mode-os-settings__theme-upload-label">
			<input
				type="file"
				accept=".zip,application/zip"
				class="desktop-mode-os-settings__file-input"
				?disabled=${ busy }
				@change=${ onFileInput }
			/>
			<span class="desktop-mode-os-settings__theme-upload-plus" aria-hidden="true"
				>+</span
			>
			<span class="desktop-mode-os-settings__theme-upload-prompt"
				>${ busy
					? __( 'Installing…' )
					: __( 'Drop a theme .zip here, or click to upload' ) }</span
			>
		</label>
	</div>`;

	/**
	 * The "restore the author's arrangement" row. Shown only for the
	 * theme the user is currently wearing, and only when it actually
	 * recommends something this shell can apply — a recommendation
	 * naming a dock rail renderer no plugin registered resolves to
	 * nothing, and an unusable button is worse than no button.
	 */
	const recommendationRow = ( themes: DesktopThemeEntry[] ) => {
		const active = themes.find(
			( theme ) => theme.slug === ctx.state.desktopTheme,
		);
		if ( ! active || ! hasApplicableThemeRecommendations( active.slug ) ) {
			return '';
		}
		return html`<div class="desktop-mode-os-settings__theme-recommendation">
			<wpd-button
				variant="secondary"
				@click=${ () => applyRecommended( active ) }
				>${ sprintf(
			/* translators: %s: theme name. */
			__( 'Apply %s’s recommended layout and effects' ),
			active.name,
		) }</wpd-button
			>
		</div>`;
	};

	function paint(): void {
		const themes = listDesktopThemes();
		render(
			html`
				<h3 class="desktop-mode-os-settings__heading">
					${ __( 'Desktop themes' ) }
				</h3>
				<p class="desktop-mode-os-settings__intro">
					${ __(
						'A desktop theme restyles the whole shell — colours, window frames, the dock, and every icon. Your choice applies only to you.',
					) }
				</p>
				${ errorText !== ''
					? html`<wpd-notice tone="error">${ errorText }</wpd-notice>`
					: '' }
				<div
					class="desktop-mode-os-settings__theme-grid"
					role="radiogroup"
					aria-label=${ __( 'Desktop theme' ) }
				>
					${ systemCard() }
					${ themes.map( ( theme ) => themeCard( theme ) ) }
				</div>
				${ recommendationRow( themes ) }
				${ canManage ? uploadTile() : '' }
			`,
			host,
		);
	}

	paint();

	// Repaint when the library changes underneath us — an admin
	// activating a plugin that registers a theme, or the live-refresh
	// payload landing. The `isConnected` guard keeps a closed Settings
	// window's stale subscriber from painting into a detached tree.
	const unsubscribe = subscribeDesktopThemes( () => {
		if ( ! host.isConnected ) {
			unsubscribe();
			return;
		}
		paint();
	} );

	return host;
}
