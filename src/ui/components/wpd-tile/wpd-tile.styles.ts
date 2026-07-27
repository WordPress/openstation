/**
 * `<wpd-tile>` — light-DOM component, so its visual chrome is
 * driven by the canonical `.desktop-mode-file-tile*` rules in
 * `assets/css/desktop-files.css`. The styles here are tiny — just
 * the host-level resets so the custom element doesn't disrupt
 * layout.
 */
import { css } from '../../core';

export const styles = css`
	:host {
		display: inline-block;
	}
`;
