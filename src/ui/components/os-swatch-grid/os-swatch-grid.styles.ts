import { css } from '../../core';

/**
 * Two layout modes:
 *
 *   - default (no `mode` attr)  — CSS grid with a fixed column
 *     count driven by `--os-ui-swatch-grid-cols` (set from the
 *     `columns` attribute). Every cell is `1fr`, so swatches grow
 *     to fill the panel. Right for wallpapers where each tile
 *     benefits from the extra preview real estate.
 *
 *   - `mode="row"`  — flex-wrap of naturally-sized children.
 *     Right for accent chips and any other "pick one of many
 *     small circles" row where uniform column widths would blow
 *     each chip up to 120 px+ on a wide panel.
 */
export const styles = css`
	:host {
		display: grid;
		grid-template-columns: repeat(
			var( --os-ui-swatch-grid-cols, 4 ),
			1fr
		);
		gap: 12px;
	}
	:host( [ mode='row' ] ) {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
	}
`;
