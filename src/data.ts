// Demo content matching the Figma mockups until real memory data exists.

export type Person = {
  name: string;
  hasPhoto: boolean;
  tint: string;
  relation: string;
  lastSeen: string;
  tags: string[];
};

export const PEOPLE: Person[] = [
  { name: 'Sky', hasPhoto: true, tint: '#5C878D', relation: 'College Friend', lastSeen: 'Last seen yesterday at College….you talked about the group project…', tags: ['College', 'COMD', 'Library'] },
  { name: 'Parth', hasPhoto: true, tint: '#336970', relation: 'Soccer Buddy', lastSeen: 'Last seen Sunday at Soccer Roof….you planned the next match…', tags: ['Soccer Roof', 'Gym', 'College'] },
  { name: 'Menf', hasPhoto: true, tint: '#29545A', relation: 'Close Friend', lastSeen: 'Last seen two days ago at 787 Coffee….he told you about his new job…', tags: ['787 Coffee', 'College', 'Gym'] },
  { name: 'Jessica', hasPhoto: true, tint: '#B98A8A', relation: 'Classmate', lastSeen: 'Last seen Monday at College….you compared midterm notes…', tags: ['College', 'COMD'] },
  { name: 'Daniel', hasPhoto: false, tint: '#C9CDCE', relation: 'Gym Neighbour', lastSeen: 'Last seen two weeks ago at the Gym….he is a college professor, just moved from Boston…', tags: ['Professor', 'Gym', 'Neighbour'] },
  { name: 'Mostafa', hasPhoto: true, tint: '#7C8586', relation: 'Cousin', lastSeen: 'Last seen last weekend at Home….family dinner and board games…', tags: ['Home', 'Family'] },
  { name: 'Nayer', hasPhoto: true, tint: '#183236', relation: 'Work Friend', lastSeen: 'Last seen Friday at Work….you grabbed lunch at Just Salad…', tags: ['Work', 'Just Salad'] },
  { name: 'Aboelkhir', hasPhoto: true, tint: '#4A7C83', relation: 'Soccer Buddy', lastSeen: 'Last seen Sunday at Soccer Roof….he scored twice…', tags: ['Soccer Roof', 'Gym'] },
  { name: 'Sara', hasPhoto: true, tint: '#85A5A9', relation: 'Childhood Friend', lastSeen: 'Last seen two weeks ago at Dunkin….you both spoke about finding a job…', tags: ['College', 'COMD', 'SVA', 'Dunkin'] },
  { name: 'Leo', hasPhoto: true, tint: '#5C878D', relation: 'Neighbour', lastSeen: 'Last seen this morning near Home….quick chat about the weekend…', tags: ['Home', 'Neighbour'] },
  { name: 'Omar', hasPhoto: false, tint: '#C9CDCE', relation: 'New Acquaintance', lastSeen: 'Last seen last week at 787 Coffee….friend of Menf…', tags: ['787 Coffee'] },
];

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

// ---- Day details for the Timeline / detailed day view ----

export type DaySegment = { period: 'Morning' | 'Afternoon' | 'Evening'; time: string; text: string };

export type DayDetail = {
  bullets: string[];
  segments: DaySegment[];
  recordedAt: string;
  audio: { position: string; duration: string };
  transcriptPreview: string;
  people: { name: string; hasPhoto: boolean }[];
  places: { name: string; hasPhoto: boolean }[];
  onThisDay: { title: string; subtitle: string };
};

const DAY_TEMPLATES: DayDetail[] = [
  {
    bullets: [
      'Web class yesterday was about midterm next week.',
      'You met with your advisor after class at 3:25.',
      'After college you and Josh went to 787 cafe.',
      'You both talked about getting back to the gym next week.',
    ],
    segments: [
      { period: 'Morning', time: '≈ 9:50 AM – 11:30 AM', text: 'Attended your morning Web class. The lecture focused on preparing for next week’s midterm.' },
      { period: 'Afternoon', time: '≈ 12:10 PM – 3:20 PM', text: 'Met with your advisor at 3:25 to check your academic plan.\n Before that, you grabbed a latte from 787 Coffee and reviewed notes.' },
      { period: 'Evening', time: '≈ 6:00 PM – 8:00 PM', text: 'Went for a light evening walk.\n Watched YouTube tutorials while cooking dinner at home.' },
    ],
    recordedAt: '11:57 pm',
    audio: { position: '0:05', duration: '0:49' },
    transcriptPreview: 'Today i had my web class at 9:50 am were I stayed……',
    people: [{ name: 'Mehmet', hasPhoto: true }, { name: 'Parth', hasPhoto: true }, { name: 'Josh', hasPhoto: false }],
    places: [{ name: 'College', hasPhoto: true }, { name: '787 Coffee', hasPhoto: true }, { name: 'Home', hasPhoto: true }],
    onThisDay: { title: 'Arsenal vs Newcastle United', subtitle: '2 - 1 For Arsenal' },
  },
  {
    bullets: [
      'Attended your morning Web class about the midterm.',
      'Met with your advisor at 3:25 to check your academic plan.',
      'Grabbed a latte from 787 Coffee and reviewed notes.',
      'Light evening walk, then YouTube tutorials while cooking dinner.',
    ],
    segments: [
      { period: 'Morning', time: '≈ 9:50 AM – 11:30 AM', text: 'Attended your morning Web class. The lecture focused on preparing for next week’s midterm.' },
      { period: 'Afternoon', time: '≈ 12:10 PM – 3:20 PM', text: 'Met with your advisor at 3:25 to check your academic plan.\n Before that, you grabbed a latte from 787 Coffee and reviewed notes.' },
      { period: 'Evening', time: '≈ 6:00 PM – 8:00 PM', text: 'Went for a light evening walk.\n Watched YouTube tutorials while cooking dinner at home.' },
    ],
    recordedAt: '11:57 pm',
    audio: { position: '0:02', duration: '2:49' },
    transcriptPreview: 'Today i had my design class at 10:00 am were I stayed……',
    people: [{ name: 'Mehmet', hasPhoto: true }, { name: 'Parth', hasPhoto: true }, { name: 'Nayer', hasPhoto: true }],
    places: [{ name: 'College', hasPhoto: true }, { name: '787 Coffee', hasPhoto: true }],
    onThisDay: { title: 'Arsenal vs Newcastle United', subtitle: '2 - 1 For Arsenal' },
  },
  {
    bullets: [
      'Morning class, Midterm review.',
      'Met up with Maya and Josh at Starbucks for lunch.',
      'Went to the gym for a quick shoulders-and-back workout.',
      'Went to Dunkin, grabbed an icecoffee',
    ],
    segments: [
      { period: 'Morning', time: '≈ 10:00 AM – 11:45 AM', text: 'Had your design class at 10:00 AM.\nStayed after to review your midterm outline and get feedback on your latest project.' },
      { period: 'Afternoon', time: '≈ 12:15 PM – 3:30 PM', text: 'Met up with Maya and Josh at Starbucks for lunch.\nWorked together on your group presentation in the library until late afternoon.' },
      { period: 'Evening', time: '≈ 6:00 PM – 8:00 PM', text: 'Went to the gym for a quick shoulders-and-back workout.\nPicked up an iced coffee from Dunkin’ on your way home and relaxed while catching up on messages.' },
    ],
    recordedAt: '11:57 pm',
    audio: { position: '0:02', duration: '2:49' },
    transcriptPreview: 'Today i had my design class at 10:00 am were I stayed……',
    people: [{ name: 'Mehmet', hasPhoto: true }, { name: 'Parth', hasPhoto: true }, { name: 'Josh', hasPhoto: false }],
    places: [
      { name: 'College', hasPhoto: true },
      { name: 'Soccer Roof', hasPhoto: true },
      { name: 'Library', hasPhoto: false },
      { name: 'Gym', hasPhoto: true },
      { name: 'Dunkin', hasPhoto: true },
    ],
    onThisDay: { title: 'Arsenal vs New castle', subtitle: '2 - 1 For Arsenal' },
  },
];

// Days 1-3 back have logged memories; today and everything else are empty.
export function getDayDetail(offsetDays: number): DayDetail | null {
  if (offsetDays === -1) return DAY_TEMPLATES[0];
  if (offsetDays === -2) return DAY_TEMPLATES[1];
  if (offsetDays === -3) return DAY_TEMPLATES[2];
  return null;
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

export type Memory = {
  offsetDays: number; // relative to today: 1 = tomorrow, 0 = today, -1 = yesterday
  text: string;
  bold?: string[];
  people: number; // avatar count
  future?: boolean;
};

export const MEMORIES: Memory[] = [
  {
    offsetDays: 1,
    text: 'We can’t predict the Future…',
    people: 0,
    future: true,
  },
  {
    offsetDays: 0,
    text: 'Had your design class at 10:00 AM.\nStayed after to review your midterm outline and get feedback on your latest project.',
    people: 4,
  },
  {
    offsetDays: -1,
    text: '10:00 Design class and midterm review.\nLunch with friends; worked on group project.\nGym (shoulders/back) and a Dunkin iced coffee before home.',
    people: 7,
  },
  {
    offsetDays: -2,
    text: 'Morning run in the park.\nCalled Mom, then grocery run and meal prep for the week.',
    people: 2,
  },
];

export type Task = {
  title: string;
  description: string;
  time: string;
  month: string;
  day: string;
  done: boolean;
  week: 'this' | 'last';
  highlighted?: boolean;
};

export const TASKS: Task[] = [
  {
    title: 'Submit midterm outline',
    description: 'Upload the final draft to Blackboard before the deadline.',
    time: '11:00 PM',
    month: 'OCT',
    day: '01',
    done: true,
    week: 'this',
  },
  {
    title: 'Gym session',
    description: 'Short workout — back & shoulders day.',
    time: '06:15 PM',
    month: 'OCT',
    day: '02',
    done: true,
    week: 'this',
  },
  {
    title: 'Buy groceries',
    description: 'Grab eggs, milk, coffee pods, and bananas.',
    time: '03:00 PM',
    month: 'OCT',
    day: '01',
    done: true,
    week: 'this',
    highlighted: true,
  },
  {
    title: 'Clean workspace',
    description: 'Organize your desk and sort project files.',
    time: '05:00 PM',
    month: 'SEP',
    day: '28',
    done: false,
    week: 'last',
  },
  {
    title: 'Call the dentist',
    description: 'Reschedule the cleaning appointment.',
    time: '01:30 PM',
    month: 'SEP',
    day: '25',
    done: false,
    week: 'last',
  },
];
