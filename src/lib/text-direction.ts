/**
 * Detects the text direction of a string based on its character content.
 * Useful for mixed RTL/LTR documents.
 */
export function getTextDirection(text: string): 'rtl' | 'ltr' {
  if (!text) return 'ltr';

  // Basic RTL character range (Arabic, Hebrew, Persian, etc.)
  const rtlChars = /[\u0591-\u07FF\uFB1D-\uFDFD\uFE70-\uFEFC]/;
  
  // We check the first few non-whitespace characters to determine the primary direction
  const sample = text.trim().slice(0, 50);
  return rtlChars.test(sample) ? 'rtl' : 'ltr';
}
