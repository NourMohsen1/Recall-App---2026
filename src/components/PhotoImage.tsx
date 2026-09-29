import { useEffect, useState } from 'react';
import { ImageResizeMode, ImageStyle, StyleProp, View } from 'react-native';
import { Image } from 'expo-image';
import { localFile } from '../memoryLog';
import { displayUriFor, needsResolving } from '../photoUri';

// Renders a stored photo.
//
// A photo from the library is shown through the Photos library by its asset
// id, never through the file path stored at import: that path stops being
// readable when the app restarts, which blanked every imported photo after a
// relaunch. See src/photoUri.ts. The app's own files (photos the user
// picked, recordings' covers) render straight from their repaired path.

const CONTENT_FIT: Record<ImageResizeMode, 'cover' | 'contain' | 'fill' | 'none'> = {
  cover: 'cover',
  contain: 'contain',
  stretch: 'fill',
  center: 'none',
  repeat: 'cover',
  none: 'none',
};

// One warning per photo per session: enough to name a failure in the logs
// without a scroll through the Timeline flooding them.
const reported = new Set<string>();

export default function PhotoImage({
  uri,
  style,
  resizeMode = 'cover',
}: {
  uri: string;
  style?: StyleProp<ImageStyle>;
  resizeMode?: ImageResizeMode;
}) {
  // The app's own files render on the first frame; only library photos wait
  // for their id, which is an in-memory lookup after the first.
  const [source, setSource] = useState<string | null>(() =>
    needsResolving(uri) ? (uri.startsWith('ph://') ? uri : null) : localFile(uri),
  );

  useEffect(() => {
    let live = true;
    if (!needsResolving(uri)) {
      setSource(localFile(uri));
      return;
    }
    displayUriFor(uri).then((next) => {
      if (live) setSource(next);
    });
    return () => {
      live = false;
    };
  }, [uri]);

  // Not resolved yet, or gone from the library: an empty frame, not an error.
  if (!source) return <View style={style} />;

  return (
    <Image
      source={{ uri: source }}
      style={style}
      contentFit={CONTENT_FIT[resizeMode] ?? 'cover'}
      recyclingKey={uri}
      transition={120}
      onError={(e) => {
        if (reported.has(uri)) return;
        reported.add(uri);
        console.warn(`[photos] could not show a photo (${source.slice(0, 60)}…): ${e.error}`);
      }}
    />
  );
}
