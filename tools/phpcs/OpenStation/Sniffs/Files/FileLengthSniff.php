<?php
/**
 * OpenStation house sniff — file length.
 *
 * A gentle ceiling on file size: past `$maxLines` total lines
 * (default 1,000) the file gets ONE warning asking for a split.
 * Deliberately a warning, never an error — a long file is a smell,
 * not a defect, and the right moment to split is a judgement call.
 * The message is encouraging on purpose: the point is to nudge the
 * next edit toward modules in the 300–600-line comfort zone, where a
 * file still fits in one head, one review and one test file.
 *
 * The TypeScript twin lives in
 * `eslint-local-rules/os-file-length.cjs` — keep the thresholds and
 * the tone in step when touching either.
 *
 * Note the default gate (`npm run lint:php`) runs `phpcs -n` and
 * shows errors only; this warning surfaces in `npm run lint:php:all`
 * and in editors, which is exactly the advisory register it wants.
 *
 * @package OpenStation
 */

namespace OpenStation\Sniffs\Files;

use PHP_CodeSniffer\Files\File;
use PHP_CodeSniffer\Sniffs\Sniff;

/**
 * Warns once per file when it grows past the line-count comfort zone.
 */
class FileLengthSniff implements Sniff {

	/**
	 * Total lines a file may reach before the nudge.
	 *
	 * @var integer
	 */
	public $maxLines = 1000;

	/**
	 * Lower edge of the comfort zone named in the message.
	 *
	 * @var integer
	 */
	public $idealMin = 300;

	/**
	 * Upper edge of the comfort zone named in the message.
	 *
	 * @var integer
	 */
	public $idealMax = 600;

	/**
	 * Registers on the first open tag only.
	 *
	 * @return array<int>
	 */
	public function register() {
		return array( T_OPEN_TAG );
	}

	/**
	 * Measure the file once and, past the ceiling, leave one warning
	 * on line 1 — where every editor shows it without scrolling.
	 *
	 * @param File $phpcsFile The file being scanned.
	 * @param int  $stackPtr  Position of the open tag.
	 * @return int Pointer past the end of the file, so this runs once.
	 */
	public function process( File $phpcsFile, $stackPtr ) {
		$tokens = $phpcsFile->getTokens();
		$lines  = $tokens[ $phpcsFile->numTokens - 1 ]['line'];

		if ( $lines > (int) $this->maxLines ) {
			$phpcsFile->addWarning(
				'This file is %d lines — past the %d-line comfort zone. Be smart, build robust software: modules of ~%d–%d lines are easier to read, test, review and reuse. Consider splitting this one along its natural seams — future you will say thanks.',
				$stackPtr,
				'TooLong',
				array(
					$lines,
					(int) $this->maxLines,
					(int) $this->idealMin,
					(int) $this->idealMax,
				)
			);
		}

		return $phpcsFile->numTokens;
	}
}
