import { mergePeople, renamePerson } from './peopleTags';
import { migrateSuggestions } from './personSuggestions';

// Joining or renaming a person, with everything attached to their old name
// brought along.
//
// A person's name is spread across two stores — the tagged days and notes in
// peopleTags, and the app's unconfirmed face guesses in personSuggestions.
// Moving only the first leaves guesses pointing at a name that no longer
// exists, which the day screen then asks about. These wrappers exist so no
// call site has to remember the second half.

// Two profiles are the same person: fold `mergeName` into `keepName`.
export async function mergePersonEverywhere(mergeName: string, keepName: string): Promise<void> {
  await mergePeople(mergeName, keepName);
  await migrateSuggestions(mergeName, keepName);
}

// Rename, which becomes a merge when the new name is already someone. Returns
// the name the person ended up under.
export async function renamePersonEverywhere(oldName: string, newName: string): Promise<string> {
  const landedOn = await renamePerson(oldName, newName);
  await migrateSuggestions(oldName, landedOn);
  return landedOn;
}
