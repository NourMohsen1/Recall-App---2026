import { useEffect, useState } from 'react';
import { Image, ImageResizeMode, ImageStyle, StyleProp, View } from 'react-native';
import { localFile } from '../memoryLog';
import { needsResolving, resolvePhotoUri } from '../photoUri';

// Renders a stored photo URI, fetching a real file path first when the
// stored value is only an OS asset reference (`ph://…` for a photo whose
// original still lives in iCloud). See src/photoUri.ts for why those exist.
//
// Anything already stored as a file path renders immediately with no extra
// work — which is every photo that was on the device at sync time.

export default function PhotoImage({
  uri,
  style,
  resizeMode = 'cover',
}: {
  uri: string;
  style?: StyleProp<ImageStyle>;
  resizeMode?: ImageResizeMode;
}) {
  // Start with the URI itself when it's directly usable, so the common case
  // renders on the first frame instead of flashing a placeholder.
  //
  // A file path goes through localFile() even here: a photo saved before the
  // last reinstall points into the old app container, and without the repair
  // it renders blank while the file is sitting right there. See memoryLog.ts.
  const [resolved, setResolved] = useState<string | null>(() =>
    needsResolving(uri) ? null : localFile(uri),
  );

  useEffect(() => {
    if (!needsResolving(uri)) {
      setResolved(localFile(uri));
      return;
    }
    let live = true;
    setResolved(null);
    resolvePhotoUri(uri).then((next) => {
      if (live) setResolved(next);
    });
    return () => {
      live = false;
    };
  }, [uri]);

  // A photo that can't be resolved (removed from the library, or an iCloud
  // fetch that failed) shows as an empty frame rather than an error.
  if (!resolved) return <View style={style} />;

  return <Image source={{ uri: resolved }} style={style} resizeMode={resizeMode} />;
}
