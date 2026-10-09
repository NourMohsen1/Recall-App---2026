// Central asset registry: real photos and brand artwork from the Figma exports.

export const BRAND = {
  logo: require('../assets/brand/logo-main.png'),
  symbol: require('../assets/brand/symbol.png'),
};

export const MISC = {
  // The live-voice brain (assets/animations/brain.html), drawn as a still:
  // a dark round icon, and a transparent glow for dark backgrounds.
  brain: require('../assets/misc/brain-new.png'),
  // Nour's original brain — the avatar on Home's Ask pill and beside every
  // answer in Ask (his call, Oct 2026: neither still of the 3D model).
  brainAvatar: require('../assets/misc/brain-3d.png'),
  brainGlow: require('../assets/misc/brain-glow.png'),
  network: require('../assets/misc/network.png'),
  glasses: require('../assets/misc/glasses.png'),
  airpods: require('../assets/misc/airpods.png'),
};

export const ICONS = {
  home: require('../assets/icons/home.png'),
  timeline: require('../assets/icons/timeline.png'),
  tasks: require('../assets/icons/tasks.png'),
  profile: require('../assets/icons/profile.png'),
  ask: require('../assets/icons/ask.png'),
  keyboard: require('../assets/icons/keyboard.png'),
  upload: require('../assets/icons/upload.png'),
  // The arrow alone: the upload icon when its bubble is lit (the bubble is
  // then the disc).
  uploadArrow: require('../assets/icons/upload-arrow.png'),
  voice: require('../assets/icons/voice.png'),
};

export const PERSON_PLACEHOLDER = require('../assets/people/placeholder.png');

export const PEOPLE_PHOTOS: Record<string, any> = {
  Sky: require('../assets/people/sky.jpg'),
  Parth: require('../assets/people/parth.jpg'),
  Menf: require('../assets/people/menf.jpg'),
  Mehmet: require('../assets/people/menf.jpg'),
  Jessica: require('../assets/people/jessica.jpg'),
  Mostafa: require('../assets/people/mostafa.jpg'),
  Nayer: require('../assets/people/nayer.png'),
  Aboelkhir: require('../assets/people/aboelkhir.jpg'),
  Sara: require('../assets/people/sara.jpg'),
  Leo: require('../assets/people/leo.jpg'),
};

export function personPhoto(name: string) {
  return PEOPLE_PHOTOS[name] ?? PERSON_PLACEHOLDER;
}

export const PLACE_PLACEHOLDER = require('../assets/places/placeholder.png');

export const PLACE_PHOTOS: Record<string, any> = {
  Work: require('../assets/places/work.png'),
  College: require('../assets/places/college.png'),
  Home: require('../assets/places/home.png'),
  '787 Coffee': require('../assets/places/787.png'),
  'Soccer Roof': require('../assets/places/soccer.png'),
  Dunkin: require('../assets/places/dunkin.png'),
  'Just Salad': require('../assets/places/justsalad.png'),
  '21-Laundry': require('../assets/places/laundry.png'),
  'Food Truck': require('../assets/places/foodtruck.png'),
  'Rock Fitness': require('../assets/places/rock.png'),
  Gym: require('../assets/places/rock.png'),
};

export function placePhoto(name: string) {
  return PLACE_PHOTOS[name] ?? PLACE_PLACEHOLDER;
}
