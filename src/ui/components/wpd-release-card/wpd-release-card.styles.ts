/**
 * `<wpd-release-card>` styles — an album sleeve with a vinyl that
 * slides out and spins.
 *
 * The flat release art is used only as the square **sleeve** (`.cover`);
 * the record (`.disc`) is drawn entirely in CSS — concentric grooves, a
 * fixed sheen sweep, and a tinted center label — so it's a genuine
 * separate object that can emerge from behind the sleeve and rotate.
 * Two accent tokens (`--accent`, `--accent-ink`) are set from host
 * attributes so each release colors the label + button.
 *
 * Under `prefers-reduced-motion` every animation is dropped and the
 * card renders in its resting state (record already out, label upright).
 */
import { css } from '../../core';

export const styles = css`
	:host {
		display: block;
		box-sizing: border-box;
		width: 240px;
		padding: 11px;
		border-radius: 14px;
		color: #fff;
		font-family: var( --desktop-mode-font, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif );
		background: #15161b;
		border: 1px solid rgba( 255, 255, 255, 0.14 );
		box-shadow:
			0 16px 40px rgba( 0, 0, 0, 0.55 ),
			0 3px 8px rgba( 0, 0, 0, 0.3 ),
			inset 0 0 0 1px rgba( 255, 255, 255, 0.04 );
		/* Accent tints the record label + the "Update now" button. It
		 * defaults to WordPress blue and is replaced at runtime with the
		 * sleeve's dominant color (extracted from the art), unless the
		 * release filter supplies an explicit accent. */
		--accent: #2271b1;
		--accent-ink: #ffffff;
		animation: cardIn 0.5s cubic-bezier( 0.2, 1.2, 0.35, 1 ) both;
	}
	@keyframes cardIn {
		from { opacity: 0; transform: translateY( -16px ) scale( 0.96 ); }
		to   { opacity: 1; transform: none; }
	}

	.art { position: relative; height: 150px; }

	.cover {
		position: absolute; left: 2px; top: 0; width: 150px; height: 150px;
		border-radius: 2px; overflow: hidden; z-index: 3;
		box-shadow: 0 8px 20px rgba( 0, 0, 0, 0.5 ), inset 0 0 0 1px rgba( 255, 255, 255, 0.08 );
	}
	/* The sleeve is painted into a canvas by the component: it trims any
	 * uniform white frame the release art may ship, then draws the left
	 * square (the sleeve; the record is to its right). */
	.cover-canvas {
		width: 100%; height: 100%; display: block;
	}

	.disc-wrap {
		position: absolute; left: 94px; top: 2px; width: 148px; height: 148px; z-index: 2;
		animation: emerge 0.8s cubic-bezier( 0.2, 1, 0.28, 1 ) 0.45s both;
	}
	@keyframes emerge {
		from { transform: translateX( -84px ); }
		to   { transform: translateX( 0 ); }
	}
	.disc {
		position: absolute; inset: 0; border-radius: 50%;
		background:
			repeating-radial-gradient( circle at 50% 50%, rgba( 255, 255, 255, 0.05 ) 0 1px, rgba( 0, 0, 0, 0 ) 1px 2.4px ),
			radial-gradient( circle at 50% 50%, #1a1a1e 0 11%, #0a0a0c 12% 62%, #050506 100% );
		box-shadow:
			0 14px 26px rgba( 0, 0, 0, 0.6 ),
			inset 0 0 26px rgba( 0, 0, 0, 0.9 ),
			inset 0 0 0 1px rgba( 255, 255, 255, 0.05 );
		animation: settle 2.5s cubic-bezier( 0.12, 0.72, 0.16, 1 ) 0.45s both;
	}
	@keyframes settle {
		from { transform: rotate( 0 ); }
		to   { transform: rotate( 720deg ); }
	}
	.label {
		position: absolute; inset: 34%; border-radius: 50%; display: grid; place-items: center;
		text-align: center; line-height: 1;
		background: var( --accent ); color: var( --accent-ink );
		box-shadow: inset 0 0 0 2px rgba( 0, 0, 0, 0.18 ), 0 1px 2px rgba( 0, 0, 0, 0.4 );
	}
	.label .lw { font-weight: 800; font-size: 15px; letter-spacing: 0.02em; }
	.label .lv {
		font-family: var( --wpd-mono, ui-monospace, Menlo, Consolas, monospace );
		font-size: 8.5px; margin-top: 2px; opacity: 0.85;
	}
	.hole {
		position: absolute; top: 50%; left: 50%; width: 5px; height: 5px; margin: -2.5px;
		border-radius: 50%; background: #0a0a0c; box-shadow: 0 0 0 1px rgba( 255, 255, 255, 0.15 ); z-index: 2;
	}
	.sheen {
		position: absolute; inset: 0; border-radius: 50%; pointer-events: none; z-index: 3;
		background: linear-gradient( 118deg, rgba( 255, 255, 255, 0.18 ) 0%, transparent 24%, transparent 74%, rgba( 255, 255, 255, 0.1 ) 100% );
		mix-blend-mode: screen;
	}

	.meta {
		display: flex; align-items: center; gap: 10px; margin-top: 11px;
		opacity: 0; animation: fade 0.5s ease 1.05s forwards;
	}
	@keyframes fade { to { opacity: 1; } }
	.mtext { flex: 1; font-size: 13px; line-height: 1.35; color: #fff; }
	.mtext b { font-weight: 650; }
	.btn {
		flex-shrink: 0; padding: 7px 12px; border: none; border-radius: 7px;
		color: var( --accent-ink ); background: var( --accent ); font: inherit; font-size: 12px; font-weight: 600;
		cursor: pointer; box-shadow: 0 2px 8px rgba( 0, 0, 0, 0.3 ); transition: filter 0.12s;
	}
	.btn:hover { filter: brightness( 1.12 ); }
	.btn:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }

	@media ( prefers-reduced-motion: reduce ) {
		:host, .disc-wrap, .disc, .meta { animation: none !important; }
		.disc-wrap { transform: translateX( 0 ); }
		.meta { opacity: 1; }
	}
`;
