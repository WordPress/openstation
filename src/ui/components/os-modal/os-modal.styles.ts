import { css } from '../../core';
import { holoTokens } from '../../holo';

export const modalStyles = css`
	${ holoTokens }

	:host {
		display: none;
		position: fixed;
		inset: 0;
		align-items: center;
		justify-content: center;
		background: var( --os-ui-scrim, rgba( 0, 0, 0, 0.45 ) );
		/* Desktop-theme texture slot: unset resolves to none. */
		background-image: var( --os-ui-scrim-image, none );
		background-repeat: var( --os-ui-scrim-image-repeat, repeat );
		background-size: var( --os-ui-scrim-image-size, auto );
		background-position: var( --os-ui-scrim-image-position, center );
		backdrop-filter: blur( 2px );
		z-index: 10000;

		/* The dialog surface is dark regardless of the admin color
		   scheme, but the shared surface tokens the component kit
		   reads (labels, value readouts, control borders) used to
		   default to light-admin values — near-black text and gray
		   hairlines that vanish on this background. So they were
		   re-pointed here, to literals.

		   That is the wrong layer to fix it at. A --os-ui-fg on :host
		   matches the host element, which outranks anything the host
		   would INHERIT — and the palette and every desktop theme
		   declare on an ancestor. The block did not set a
		   default; it made five palette tokens unreachable inside
		   every dialog in the OS, and slotted light-DOM content
		   inherited the literals straight back out of the shadow
		   tree. A station in Pulse and Obsidian rendered its dialogs
		   in WordPress grey-blue and could not be told otherwise.

		   Each now reads the palette FIRST and keeps its old literal
		   as the fallback, so a dark dialog is still readable if the
		   stylesheet never loads — which is the case the literals
		   were guarding all along. */
		--os-ui-fg: var( --os-ui-modal-text, #f0f0f1 );
		--os-ui-fg-muted: var( --os-ui-modal-text-muted, #a7aaad );
		--os-ui-border: var( --os-ui-modal-border, rgba( 255, 255, 255, 0.25 ) );
		/* Input / popover surface. The unthemed default is #fff
		   (windows are light), which here rendered white fields with
		   the light --os-ui-fg above — near-invisible values. Solid,
		   not translucent: os-menu / os-multiselect popovers read
		   this token too and must stay opaque over slotted content. */
		--os-window-bg: var( --os-ui-modal-field-bg, #2c3338 );
		/* Ghost/secondary button hover washes — the light-surface
		   defaults are black-on-black here. */
		--os-ui-button-bg-hover: var(
			--os-ui-modal-button-bg-hover,
			rgba( 255, 255, 255, 0.08 )
		);
	}

	/*
	 * Two animations, because a dialog is two things.
	 *
	 * The SCRIM fades. It is a state change over the whole viewport
	 * and anything else would draw the eye to the background at the
	 * exact moment the foreground is asking for attention.
	 *
	 * The DIALOG scales in from 96% on the spring, and lands slightly
	 * faster than the scrim finishes — so the surface arrives on top
	 * of a backdrop that is already there, which is the order the eye
	 * expects from a physical object.
	 *
	 * Both hang off [open] rather than the base rule: this component
	 * toggles display rather than mounting, so a keyframe on :host
	 * would only ever run the first time.
	 */
	:host( [ open ] ) {
		display: flex;
		animation: os-modal-scrim var( --_holo-t ) var( --_holo-ease );
	}

	:host( [ open ] ) .dialog {
		animation: os-modal-dialog var( --_holo-t ) var( --_holo-spring );
	}

	@keyframes os-modal-scrim {
		from {
			opacity: 0;
		}
	}

	@keyframes os-modal-dialog {
		from {
			opacity: 0;
			transform: scale( 0.96 ) translateY( 8px );
		}
	}

	@media ( prefers-reduced-motion: reduce ) {
		:host( [ open ] ),
		:host( [ open ] ) .dialog {
			animation: none;
		}
	}

	.dialog {
		max-width: 92vw;
		max-height: 90vh;
		/* Longhand on purpose: the texture slot below owns
		   background-image, and the shorthand would reset it. The
		   fallback must be a literal colour — --os-bg is the
		   wallpaper token and can hold a gradient, which is invalid as
		   a background-color and would leave the dialog transparent. */
		background-color: var( --os-ui-modal-bg, #1d2327 );
		/* Desktop-theme texture slot: unset resolves to none. */
		background-image: var( --os-ui-dialog-bg-image, none );
		background-repeat: var( --os-ui-dialog-bg-image-repeat, repeat );
		background-size: var( --os-ui-dialog-bg-image-size, auto );
		background-position: var( --os-ui-dialog-bg-image-position, center );
		color: var( --os-ui-modal-fg, var( --os-fg, #fff ) );
		border: 1px solid var( --os-ui-border, rgba( 255, 255, 255, 0.08 ) );
		border-radius: 10px;
		box-shadow: 0 20px 50px rgba( 0, 0, 0, 0.6 );
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	:host( [ size='sm' ] ) .dialog {
		width: min( 360px, 92vw );
	}

	:host( :not( [ size ] ) ) .dialog,
	:host( [ size='md' ] ) .dialog {
		width: min( 540px, 92vw );
	}

	:host( [ size='lg' ] ) .dialog {
		width: min( 760px, 94vw );
	}

	.header {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 16px 20px 12px;
		border-bottom: 1px solid var( --os-ui-border, rgba( 255, 255, 255, 0.06 ) );
	}

	.title {
		margin: 0;
		flex: 1;
		font-size: 15px;
		font-weight: 600;
	}

	.header-actions {
		display: flex;
		gap: 6px;
	}
	.header-actions ::slotted( * ) {
		margin-inline-start: 6px;
	}

	.close {
		background: transparent;
		border: 0;
		color: inherit;
		font-size: 18px;
		line-height: 1;
		padding: 4px 8px;
		border-radius: 4px;
		cursor: pointer;
		opacity: 0.7;
	}
	.close:hover {
		opacity: 1;
		background: var( --os-ui-hover, rgba( 255, 255, 255, 0.08 ) );
	}

	.body {
		padding: 16px 20px;
		overflow: auto;
		flex: 1 1 auto;
		font-size: 13px;
		line-height: 1.5;
	}

	.footer {
		padding: 12px 20px 16px;
		border-top: 1px solid var( --os-ui-border, rgba( 255, 255, 255, 0.06 ) );
	}
	/* The slot is the flex container — gap on .footer would only
	   space the slot from its siblings (there are none), not the
	   slotted buttons. Making the slot flex applies the gap to the
	   actual rendered button row. */
	.footer slot {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
		flex-wrap: wrap;
	}

	:host( [ mandatory ] ) .close {
		display: none;
	}
`;
