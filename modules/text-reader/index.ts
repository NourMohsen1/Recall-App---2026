import { requireOptionalNativeModule } from 'expo';

// Reads the words in a screenshot or PDF on the phone. See
// ios/TextReaderModule.swift.
//
// Optional on purpose: JavaScript reaches a phone over Wi-Fi before the
// native build that contains this module does. A build without it must keep
// working and say so, not crash at startup.

export type ReadResult = {
  text: string;
  pages: number;
  /** Pages that were pictures of text and had to be read like a photo. */
  scannedPages: number;
  /** PDFs only: page one as an image. */
  previewUri?: string;
};

type Native = {
  readImage(uri: string): Promise<ReadResult>;
  readPdf(uri: string, maxPages: number, previewPath: string): Promise<ReadResult>;
};

const native = requireOptionalNativeModule<Native>('TextReader');

export const textReaderAvailable = native != null;

export async function readImageText(uri: string): Promise<ReadResult> {
  if (!native) throw new Error('This build of Recall cannot read documents yet — it needs the app update.');
  return native.readImage(uri);
}

export async function readPdfText(uri: string, previewPath: string, maxPages = 10): Promise<ReadResult> {
  if (!native) throw new Error('This build of Recall cannot read documents yet — it needs the app update.');
  return native.readPdf(uri, maxPages, previewPath);
}
