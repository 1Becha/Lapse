import { extractText, getDocumentProxy } from 'unpdf';

export function isPdf(bytes: Uint8Array): boolean {
  return bytes.length > 4 && Buffer.from(bytes.subarray(0, 5)).toString('latin1') === '%PDF-';
}

// Returns the text layer. Scanned PDFs have none and return an empty string.
export async function pdfText(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text, totalPages } = await extractText(pdf, { mergePages: true });
  return { text: text.trim(), pages: totalPages };
}
