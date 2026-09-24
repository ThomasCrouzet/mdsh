// Match the @page rules in static/print/print.css and print-desktop.ts.
// The PDF width E2E test checks these dimensions against an exported PDF.
export const PRINT_PAGE = {
	widthMm: 210,
	marginInlineMm: 16
} as const;

export const PRINT_TEXT_WIDTH_MM = PRINT_PAGE.widthMm - 2 * PRINT_PAGE.marginInlineMm;
export const PRINT_TEXT_WIDTH_PX = (PRINT_TEXT_WIDTH_MM * 96) / 25.4;
