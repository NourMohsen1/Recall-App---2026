// The duplicate-photo repair on a made-up phone (not voice, but the same
// harness): what stays, what goes.
import { getLoggedMemories, saveMemory } from '@app/memoryLog';
import { getAllPhotoMeta, setPhotoMetaBatch } from '@app/photoMeta';
import { removeDuplicatePhotos } from '@app/photoImport';
(async () => {
  const day = (d: number) => new Date(2026, 9, d, 12);
  await setPhotoMetaBatch([
    ['file:///DCIM/A.jpg', { takenAt: +day(3), assetId: 'A' }],
    ['file:///DCIM/B.jpg', { takenAt: +day(3), assetId: 'B' }],
    ['ph://B', { takenAt: +day(3), assetId: 'B' }],            // B again, another path
    ['file:///DCIM/C.jpg', { takenAt: +day(6), assetId: 'C' }],
    ['file:///Recall/mine.jpg', { takenAt: +day(6) }],          // hand-added copy
  ] as any);
  await saveMemory({ kind: 'photo', photoUris: ['file:///DCIM/A.jpg', 'file:///DCIM/B.jpg', 'file:///DCIM/A.jpg', 'ph://B'], takenAt: day(3) } as any);
  await saveMemory({ kind: 'photo', photoUris: ['file:///DCIM/C.jpg', 'file:///DCIM/C.jpg', 'file:///DCIM/C.jpg'], takenAt: day(6) } as any);
  await saveMemory({ kind: 'photo', manual: true, photoUris: ['file:///Recall/mine.jpg'], takenAt: day(6) } as any);
  const show = async (when: string) => {
    for (const m of await getLoggedMemories()) console.log(`  ${when} ${new Date(m.takenAt).getDate()} Oct${m.manual ? ' (added by hand)' : ''}: ${(m.photoUris ?? []).map((u) => u.split('/').pop()).join(', ')}`);
  };
  await show('before');
  await removeDuplicatePhotos();
  await show('after ');
  console.log('  photo details left:', Object.keys(await getAllPhotoMeta()).map((u) => u.split('/').pop()).join(', '));
  await removeDuplicatePhotos(); // a second launch does nothing
})();
