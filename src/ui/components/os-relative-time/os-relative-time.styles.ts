/**
 * `<os-relative-time>` — shadow-DOM styles. Minimal: the host
 * rebuilds itself as inline text, so all we do is set `display:
 * inline` (default for custom elements is `inline`, but we make it
 * explicit) and let consumers theme via the inherited text color.
 */
import { css } from '../../core';

export const styles = css`
	:host {
		display: inline;
		color: inherit;
		font: inherit;
	}
`;
