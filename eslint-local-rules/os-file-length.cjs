/**
 * Custom ESLint rule — `os-file-length`.
 *
 * A gentle ceiling on file size: past `max` total lines (default
 * 1,000) the file gets ONE warning asking for a split. Deliberately a
 * warning, never an error — a long file is a smell, not a defect, and
 * the right moment to split is a judgement call. The message is
 * encouraging on purpose: the point is to nudge the next edit toward
 * modules in the 300–600-line comfort zone, where a file still fits
 * in one head, one review and one test file.
 *
 * The PHP twin lives in
 * `tools/phpcs/OpenStation/Sniffs/Files/FileLengthSniff.php` — keep
 * the thresholds and the tone in step when touching either.
 */

'use strict';

module.exports = {
	meta: {
		type: 'suggestion',
		docs: {
			description:
				'Warn when a file grows past the line-count comfort zone and suggest splitting it.',
		},
		schema: [
			{
				type: 'object',
				properties: {
					max: { type: 'integer', minimum: 1 },
					idealMin: { type: 'integer', minimum: 1 },
					idealMax: { type: 'integer', minimum: 1 },
				},
				additionalProperties: false,
			},
		],
		messages: {
			considerSplitting:
				'This file is {{lines}} lines — past the {{max}}-line comfort zone. Be smart, build robust software: modules of ~{{idealMin}}–{{idealMax}} lines are easier to read, test, review and reuse. Consider splitting this one along its natural seams — future you will say thanks.',
		},
	},

	create( context ) {
		const options = context.options[ 0 ] || {};
		const max = options.max || 1000;
		const idealMin = options.idealMin || 300;
		const idealMax = options.idealMax || 600;

		return {
			'Program:exit'( node ) {
				const lines = context.getSourceCode().lines.length;
				if ( lines <= max ) {
					return;
				}
				context.report( {
					// Anchor on the first line — one warning per file,
					// where every editor shows it without scrolling.
					loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
					node,
					messageId: 'considerSplitting',
					data: {
						lines: String( lines ),
						max: String( max ),
						idealMin: String( idealMin ),
						idealMax: String( idealMax ),
					},
				} );
			},
		};
	},
};
