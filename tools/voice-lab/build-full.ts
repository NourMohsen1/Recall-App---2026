// Adds every other kind of memory to the test year, through the app's own
// functions: moments, a birthday, tasks, a saved ticket, a person's details
// and nickname, a recognised face, photos not read yet.
//   VOICE_LAB_SAVE_TO=…/seed-full.json node run.mjs build-full "" seed-year.json
import { addDayMarker, addRecurringMarker } from '@app/dayMarkers';
import { addTask } from '@app/tasks';
import { saveMemory } from '@app/memoryLog';
import { addNickname, setPersonDescriptor } from '@app/peopleTags';
import { addGuess } from '@app/guessedPeople';
import { setPhotoMetaBatch } from '@app/photoMeta';
(async () => {
  await addDayMarker('2026-10-10', { kind: 'medicine', label: 'أخدت الدوا', source: 'log' } as any);
  await addDayMarker('2026-09-20', { kind: 'medicine', label: 'أخدت الدوا', source: 'log' } as any);
  await addRecurringMarker({ kind: 'birthday', label: 'عيد ميلاد عمر', every: 'year', month: 11, day: 22, person: 'Omar' } as any);
  await addTask({ title: 'Renew my passport', dueDate: '2026-10-25', source: 'manual' } as any);
  await addTask({ title: 'ادفع فاتورة النت', dueDate: '2026-10-20', source: 'manual' } as any);
  await saveMemory({ kind: 'document', text: 'Saved my flight ticket to Dubai: Emirates EK 928, Monday 2 November 2026 at 9:40 am from Cairo, gate C14, seat 32A.', takenAt: new Date(2026, 9, 15, 20, 0) } as any);
  await setPersonDescriptor('Sara', 'coworker at the design studio');
  await addNickname('Omar', 'الكتش');
  await addGuess('2026-03-13', 'Sara', 1);
  const uris = Array.from({ length: 12 }, (_, i) => `file:///DCIM/IMG_9${i}.jpg`);
  await setPhotoMetaBatch(uris.map((u, i) => [u, { takenAt: +new Date(2026, 3, 10, 14, i), assetId: `U${i}`, privacyChecked: true }]) as any);
  await saveMemory({ kind: 'photo', photoUris: uris, takenAt: new Date(2026, 3, 10, 14, 0) } as any);
  console.log('full test phone built');
})();
