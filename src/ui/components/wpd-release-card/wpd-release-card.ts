/**
 * `<wpd-release-card>` — the major-release update moment.
 *
 * A WordPress major ships music-themed "Release Edition" art every time
 * (Armstrong 7.0, Gene 6.9, …). This card uses that art as an album
 * **sleeve** and slides a CSS-drawn **vinyl** out from behind it — the
 * flat PNG never has to be cut apart, so the record can genuinely emerge
 * and spin. The center label is tinted to the release accent and shows
 * the version; the "Update now" button emits `wpd-release-update`.
 *
 * It's the richer sibling of the plain update toast: the shell picks
 * this for a major release when release art is available, and falls back
 * to the toast otherwise. Under `prefers-reduced-motion` the card
 * renders static (record already out, no spin) — the stylesheet owns
 * that; no JS branch needed.
 *
 * Usage (normally mounted by the shell, not hand-authored):
 *
 *   <wpd-release-card
 *     art="…/7.0.jpg" version="7.0" name="Armstrong"
 *     accent="#ef5a3c" accent-ink="#171717"></wpd-release-card>
 *
 * @since 0.9.3
 */

import { Component, defineComponent, html } from '../../core';
import { styles } from './wpd-release-card.styles';
import { __ } from '../../../i18n';

export class WpdReleaseCard extends Component {
	static props = [ 'art', 'version', 'name', 'accent', 'accentInk' ] as const;
	static styles = [ styles ];

	static help = {
		title: 'Release card',
		summary:
			'The major-release update moment: the release art as an album sleeve with a CSS-drawn vinyl that slides out and spins. Falls back to the plain toast for minor releases. Emits wpd-release-update on the "Update now" button; renders static under prefers-reduced-motion.',
		status: 'experimental',
		since: '0.9.3',
		props: [
			{ name: 'art', type: 'string', description: 'URL of the square sleeve/cover image.' },
			{ name: 'version', type: 'string', description: 'Version shown on the label + message (e.g. "7.0").' },
			{ name: 'name', type: 'string', description: 'Release codename shown in the message (e.g. "Armstrong").' },
			{ name: 'accent', type: 'string', description: 'Accent color for the record label + button.' },
			{ name: 'accent-ink', type: 'string', description: 'Text color on the accent-colored label.' },
		],
		events: [
			{ name: 'wpd-release-update', description: 'Fires when the "Update now" button is clicked.', detail: '{}' },
		],
		cssProps: [
			{ name: '--accent', description: 'Record-label + button color (usually set from the `accent` attribute).' },
			{ name: '--accent-ink', description: 'Label text color over the accent.' },
		],
		example: html`
			<wpd-release-card
				art="/wp-content/plugins/desktop-mode/assets/releases/7.0.jpg"
				version="7.0" name="Armstrong" accent="#ef5a3c" accent-ink="#171717"
			></wpd-release-card>
		`,
	} as const;

	connectedCallback(): void {
		super.connectedCallback();
		if ( ! this.hasAttribute( 'role' ) ) {
			this.setAttribute( 'role', 'status' );
		}
		// Mirror the accent attributes onto host custom properties so the
		// shadow-DOM label + button pick them up.
		const accent = this.getAttribute( 'accent' );
		if ( accent ) {
			this.style.setProperty( '--accent', accent );
		}
		const ink = this.getAttribute( 'accent-ink' );
		if ( ink ) {
			this.style.setProperty( '--accent-ink', ink );
		}
	}

	protected render() {
		const art = this.getAttribute( 'art' ) ?? '';
		const version = this.getAttribute( 'version' ) ?? '';
		const name = this.getAttribute( 'name' ) ?? '';

		return html`
			<div class="art">
				<div class="disc-wrap">
					<div class="disc">
						<div class="label">
							<span class="lw">W</span>
							<span class="lv">${ version }</span>
						</div>
						<span class="hole"></span>
					</div>
					<div class="sheen"></div>
				</div>
				<div class="cover">
					<img src=${ art } alt="" />
					<span class="spine"></span>
				</div>
			</div>
			<div class="meta">
				<span class="mtext"
					>WordPress <b>${ version }</b>
					<span class="rel">"${ name }"</span> ${ __( 'is available.' ) }</span
				>
				<button
					type="button"
					class="btn"
					@click=${ ( e: Event ) => this._onUpdate( e ) }
				>
					${ __( 'Update now' ) }
				</button>
			</div>
		`;
	}

	private _onUpdate( e: Event ): void {
		e.preventDefault();
		e.stopPropagation();
		this.emit( 'wpd-release-update', {} );
	}
}
defineComponent( 'wpd-release-card', WpdReleaseCard );
