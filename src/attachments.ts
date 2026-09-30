import * as FileSystem from 'expo-file-system/legacy';
import { readImageText, readPdfText, textReaderAvailable } from '../modules/text-reader';
import { processMemoryIntake } from './memoryIntake';
import { isPrivateFile } from './photoGuard';
import { dateKey, localFile, persistFile, saveMemory, type Attachment } from './memoryLog';

// A screenshot or file saved as a memory — an appointment confirmation, a
// ticket, a bill. The phone reads it (modules/text-reader); the words go to
// the intake like anything the user logs, and an upcoming appointment in it
// becomes a task with its details and reminders.
//
// PRIVATE BY CONSTRUCTION: the file itself never leaves the device. It is
// not a photo memory, so photo analysis never sees it and face indexing
// never reads it. Only the words do, the same as if the user had typed them.

export { textReaderAvailable };

/** The screenshot looks private, so it was not saved. */
export class PrivatePhotoError extends Error {
  constructor() {
    super('This image looks private, so Recall left it out.');
  }
}

export type PickedFile = { uri: string; name?: string; mimeType?: string };

export function isPdf(f: PickedFile): boolean {
  return !!f.mimeType?.includes('pdf') || !!f.name?.toLowerCase().endsWith('.pdf');
}

/** Keeps the file, reads it, saves the memory and starts the intake.
 *  Returns what was read, so the screen can say if the file had no words. */
export async function saveAttachmentMemory(
  file: PickedFile,
  note: string,
): Promise<{ memoryId: string; words: number }> {
  const pdf = isPdf(file);
  if (!pdf && (await isPrivateFile(file.uri))) throw new PrivatePhotoError();
  const stored = await persistFile(file.uri, pdf ? 'doc' : 'shot');
  const attachment: Attachment = { uri: stored, kind: pdf ? 'pdf' : 'image', name: file.name };

  const started = Date.now();
  try {
    if (pdf) {
      const previewPath = `${FileSystem.documentDirectory}doc-preview-${Date.now()}.jpg`;
      const read = await readPdfText(localFile(stored), previewPath);
      attachment.text = read.text;
      if (read.previewUri) attachment.previewUri = read.previewUri;
      console.log(
        `[attach] read ${read.text.length} chars from a ${read.pages}-page PDF` +
          (read.scannedPages > 0 ? ` (${read.scannedPages} scanned)` : '') +
          ` in ${Date.now() - started}ms`,
      );
    } else {
      const read = await readImageText(localFile(stored));
      attachment.text = read.text;
      console.log(`[attach] read ${read.text.length} chars from an image in ${Date.now() - started}ms`);
    }
  } catch (e) {
    // Saved anyway: the file is the user's, and the note still counts. But
    // said loudly — a document that silently reads as empty would look like
    // the app ignored it.
    console.warn('[attach] could not read the file:', e);
  }

  const trimmed = note.trim();
  const saved = await saveMemory({
    kind: 'document',
    text: trimmed || undefined,
    attachments: [attachment],
  });
  processMemoryIntake(saved.id, trimmed, dateKey(new Date())).catch((e) =>
    console.warn('[attach] intake failed:', e),
  );
  const words = (attachment.text ?? '').split(/\s+/).filter(Boolean).length;
  return { memoryId: saved.id, words };
}
