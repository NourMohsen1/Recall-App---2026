import { requireOptionalNativeModule } from 'expo';

// See ios/PhotoGuardModule.swift. Optional: a build without it keeps
// working (the JS reaches a phone before the native build that has it).

export type AssetCheck = { id: string; score?: number; apple?: boolean; missing?: boolean };

type Native = {
  checkAssets(ids: string[]): Promise<AssetCheck[]>;
  checkFile(uri: string): Promise<{ score: number; apple: boolean }>;
  existingAssets(ids: string[]): Promise<string[]>;
  libraryAccess(): 'full' | 'limited' | 'none';
  cloudIds(ids: string[]): Promise<Record<string, string>>;
  localIdsForCloudIds(cloud: string[]): Promise<Record<string, string>>;
};

const native = requireOptionalNativeModule<Native>('PhotoGuard');

export const photoGuardAvailable = native != null;

export function checkAssets(ids: string[]): Promise<AssetCheck[]> {
  if (!native) throw new Error('photo-guard is not in this build');
  return native.checkAssets(ids);
}

export function checkFile(uri: string): Promise<{ score: number; apple: boolean }> {
  if (!native) throw new Error('photo-guard is not in this build');
  return native.checkFile(uri);
}

export function existingAssets(ids: string[]): Promise<string[]> {
  if (!native) throw new Error('photo-guard is not in this build');
  return native.existingAssets(ids);
}

export function libraryAccess(): 'full' | 'limited' | 'none' {
  if (!native) return 'none';
  return native.libraryAccess();
}

export function cloudIds(ids: string[]): Promise<Record<string, string>> {
  if (!native) throw new Error('photo-guard is not in this build');
  return native.cloudIds(ids);
}

export function localIdsForCloudIds(cloud: string[]): Promise<Record<string, string>> {
  if (!native) throw new Error('photo-guard is not in this build');
  return native.localIdsForCloudIds(cloud);
}
