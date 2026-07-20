// Demo content matching the Figma mockups until real memory data exists.

export type Place = {
  name: string;
  icon: string;
  hasPhoto: boolean;
  subtitle?: string;
  lastVisited?: string;
  tags?: string[];
};

export const PLACES: Place[] = [
  { name: 'Work', icon: 'briefcase', hasPhoto: true },
  { name: 'College', icon: 'school', hasPhoto: true },
  { name: 'Home', icon: 'home', hasPhoto: true },
  { name: '787 Coffee', icon: 'coffee', hasPhoto: true },
  { name: 'Soccer Roof', icon: 'soccer', hasPhoto: true },
  { name: 'Dunkin', icon: 'coffee-outline', hasPhoto: true },
  { name: 'Just Salad', icon: 'food-apple', hasPhoto: true },
  { name: '21-Laundry', icon: 'washing-machine', hasPhoto: true },
  { name: '87-Deli', icon: 'storefront', hasPhoto: false },
  { name: 'Food Truck', icon: 'truck', hasPhoto: true },
  { name: 'Rock Fitness', icon: 'dumbbell', hasPhoto: true },
];

export const PLACE_DETAILS: Record<string, { subtitle: string; lastVisited: string; tags: string[] }> = {
  College: {
    subtitle: 'You go there frequently',
    lastVisited: 'Last visited yesterday at COMD 3500 Class…. Prof talked about the final project..',
    tags: ['Finals', 'Teacher', 'CityTech'],
  },
};

export function placeDetail(name: string) {
  return (
    PLACE_DETAILS[name] ?? {
      subtitle: 'You visit from time to time',
      lastVisited: `Last visited recently…. memories captured at ${name} live here..`,
      tags: [name],
    }
  );
}

export const MONTHS_SHORT = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function dateWithOffset(offsetDays: number) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d;
}

export function shortDate(d: Date) {
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

