import { css } from '../../core';

/**
 * `<os-facts>` + `<os-fact>` — the label/value list.
 *
 * Two stylesheets, one per element, so each adopts only the rules
 * that apply to it. Every colour, size and gap resolves through a
 * public token read into a private alias, so a desktop theme can
 * restyle a facts list without forking the component.
 *
 * ## Why the rows are `display: contents`
 *
 * The list is a real `<dl>` in the shadow root and the rows are
 * light-DOM children slotted into it, so in the flattened tree an
 * `<os-fact>` sits between the `<dl>` and its `<dt>`/`<dd>`. In the
 * default column layout, `display: contents` takes the row out of
 * the box tree AND the accessibility tree, so the pairs reattach to
 * the list and land in the parent grid's two columns rather than in
 * one cell each. `between` and `stacked` give the row a box again
 * (flex, block), which is the `dl > div > dt + dd` grouping HTML
 * allows.
 */

export const factsStyles = css`
	:host {
		--_gap-row: var( --os-ui-facts-row-gap, 6px );
		--_gap-column: var( --os-ui-facts-column-gap, 14px );
		display: block;
		font-size: var( --os-ui-facts-font-size, 13px );
		min-inline-size: 0;
	}
	:host( [ hidden ] ) {
		display: none;
	}
	dl {
		display: grid;
		grid-template-columns: max-content minmax( 0, 1fr );
		gap: var( --_gap-row ) var( --_gap-column );
		align-items: var( --os-ui-facts-align, baseline );
		margin: 0;
	}

	/*
	 * 'between' pushes the value to the far edge of its own line
	 * instead of aligning it to a shared column. Written as
	 * ::slotted() so it overrides the row's own 'display: contents'
	 * — an outer tree's rules win over the inner tree's ':host'.
	 */
	:host( [ layout='between' ] ) dl {
		display: block;
	}
	:host( [ layout='between' ] ) ::slotted( os-fact ) {
		display: flex;
		justify-content: space-between;
		gap: var( --_gap-column );
		margin-block: var( --_gap-row );
	}

	/*
	 * 'stacked' is the narrow case: the label sits above its value
	 * rather than beside it, so neither has to survive a column
	 * barely wider than a word.
	 */
	:host( [ stacked ] ) dl {
		display: block;
	}
	:host( [ stacked ] ) ::slotted( os-fact ) {
		display: block;
		margin-block: var( --_gap-row );
	}
`;

export const factStyles = css`
	:host {
		/* See the note above: this is what makes the pair a row of
		   the list rather than a box between the list and its pairs. */
		display: contents;
	}
	:host( [ hidden ] ) {
		display: none;
	}
	dt {
		color: var( --os-ui-facts-label-color, var( --os-ui-fg-muted, #646970 ) );
	}
	dd {
		margin: 0;
		/*
		 * Facts carry file paths, slugs and URLs — strings with no
		 * spaces to break at. Without this one of them widens the
		 * value column until the list overflows its pane.
		 */
		overflow-wrap: anywhere;
	}

	/*
	 * A value that is inline code loses the snippet chrome and keeps
	 * the copy affordance. In a facts list the value IS the code —
	 * a file path, an id — so a badge around it is a box inside a
	 * box.
	 *
	 * This opts out of the theme's code chrome, not out of theming:
	 * each value is re-pointed through a facts-owned token, so a
	 * desktop theme that wants its snippet chrome back inside a facts
	 * list sets those.
	 */
	::slotted( os-code ) {
		--os-ui-code-bg: var( --os-ui-facts-code-bg, transparent );
		--os-ui-code-border: var( --os-ui-facts-code-border, none );
		--os-ui-code-padding: var( --os-ui-facts-code-padding, 0 );
		--os-ui-code-font-size: var( --os-ui-facts-code-font-size, 1em );
	}
`;
