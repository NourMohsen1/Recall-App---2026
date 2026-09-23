import AsyncStorage from '@react-native-async-storage/async-storage';
import { dateKey } from './memoryLog';

// "On This Day" feed: for each past day, pull what happened in the world in
// the user's interest areas (chosen in the onboarding quiz, defaulting to
// Sports / Music / News). Content is fetched from the internet via OpenAI's
// web-search model, cached per day, and falls back to seeded demo items when
// no API key/credits are available.

export type TopicKey =
  | 'sports'
  | 'music'
  | 'news'
  | 'movies'
  | 'design'
  | 'travel'
  | 'books';

export type Topic = { key: TopicKey; label: string; query: string };

export type TopicItem = {
  topic: TopicKey;
  label: string;
  headline: string;
  summary: string;
  live: boolean; // true when fetched from the internet, false for seeded demo
  image?: string; // direct URL to a related news photo, when the search found one
};

const ALL_TOPICS: Record<string, Topic> = {
  Sports: {
    key: 'sports',
    label: 'Sports',
    query: 'a major sports result (like a football/soccer match score or big game)',
  },
  Music: {
    key: 'music',
    label: 'Music',
    query: 'a notable music release, chart record, or trending song/album',
  },
  News: {
    key: 'news',
    label: 'News',
    query: 'a major general news story or trending world event',
  },
  'World Events': {
    key: 'news',
    label: 'News',
    query: 'a major world news story or trending event',
  },
  Movies: {
    key: 'movies',
    label: 'Movies',
    query: 'a notable movie release, box office story, or entertainment event',
  },
  Design: {
    key: 'design',
    label: 'Design',
    query: 'a notable design, art, or architecture story',
  },
  Travel: {
    key: 'travel',
    label: 'Travel',
    query: 'a notable travel or destination story',
  },
  Books: {
    key: 'books',
    label: 'Books',
    query: 'a notable book release or literary story',
  },
};

const DEFAULT_TOPICS = [ALL_TOPICS.Sports, ALL_TOPICS.Music, ALL_TOPICS.News];

// Every distinct topic the user can choose from, for the "swap this topic"
// picker. De-duplicated by key (News + World Events both map to 'news').
export const TOPIC_OPTIONS: Topic[] = Object.values(ALL_TOPICS).filter(
  (t, i, arr) => arr.findIndex((u) => u.key === t.key) === i,
);

const OVERRIDE_KEY = 'otdTopicOverride';

async function quizTopics(): Promise<Topic[]> {
  try {
    const raw = await AsyncStorage.getItem('quizAnswers');
    if (!raw) return DEFAULT_TOPICS;
    const answers: string[][] = JSON.parse(raw);
    const picked = (answers[0] ?? [])
      .map((label) => ALL_TOPICS[label])
      .filter(Boolean) as Topic[];
    const unique: Topic[] = [];
    for (const t of picked) {
      if (!unique.some((u) => u.key === t.key)) unique.push(t);
    }
    for (const d of DEFAULT_TOPICS) {
      if (unique.length >= 3) break;
      if (!unique.some((u) => u.key === d.key)) unique.push(d);
    }
    return unique.slice(0, 3);
  } catch {
    return DEFAULT_TOPICS;
  }
}

// The user's three feed topics. Starts from the onboarding quiz answers
// (question 1: "What kind of content inspires you most?"), but once the user
// swaps a topic out via feedback on a card, that override sticks — the app
// is adapting to the user, not just replaying the quiz forever.
export async function getInterestTopics(): Promise<Topic[]> {
  try {
    const raw = await AsyncStorage.getItem(OVERRIDE_KEY);
    if (raw) {
      const keys: TopicKey[] = JSON.parse(raw);
      const topics = keys.map((k) => TOPIC_OPTIONS.find((t) => t.key === k)).filter(Boolean) as Topic[];
      if (topics.length > 0) return topics;
    }
  } catch {
    // fall through to quiz-derived topics
  }
  return quizTopics();
}

// Feedback: "this topic isn't relevant to me" — swaps it for a different one
// and remembers the choice going forward.
export async function swapTopic(outgoing: TopicKey, incoming: TopicKey): Promise<Topic[]> {
  const current = await getInterestTopics();
  const next = current.map((t) => (t.key === outgoing ? TOPIC_OPTIONS.find((o) => o.key === incoming)! : t));
  await AsyncStorage.setItem(OVERRIDE_KEY, JSON.stringify(next.map((t) => t.key)));
  return next;
}

// ---- Per-topic taste: what the user actually cares about inside a topic ----
// Free text like "Premier League, Real Madrid, Formula 1" — steers what the
// web search looks for so Sports means *their* sports, not sports in general.

const INTERESTS_KEY = 'otdTopicInterests';

export async function getTopicInterests(): Promise<Partial<Record<TopicKey, string>>> {
  try {
    const raw = await AsyncStorage.getItem(INTERESTS_KEY);
    return raw ? (JSON.parse(raw) as Partial<Record<TopicKey, string>>) : {};
  } catch {
    return {};
  }
}

export async function setTopicInterest(key: TopicKey, text: string): Promise<void> {
  const all = await getTopicInterests();
  const trimmed = text.trim();
  if (trimmed) all[key] = trimmed;
  else delete all[key];
  await AsyncStorage.setItem(INTERESTS_KEY, JSON.stringify(all));
}

// Tiny stable hash so caches invalidate when the user's taste text changes.
function tinyHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

// ---- Seeded fallback content (used when the internet fetch is unavailable) ----

const FALLBACKS: Record<TopicKey, { headline: string; summary: string }[]> = {
  sports: [
    {
      headline: 'Arsenal vs Newcastle United 2 - 1 For Arsenal',
      summary: 'The game ended with a late 2–1 comeback victory for Arsenal.',
    },
    {
      headline: 'West Ham United draw 1-1 at Everton',
      summary:
        'A solid start for new boss Nuno Espirito Santo with Jarrod Bowen scoring the equalizer.',
    },
  ],
  music: [
    {
      headline: 'Cardi B’s ‘Am I The Drama?’ Earns Double Platinum',
      summary: 'Certification arrives 10 days after dropping.',
    },
    {
      headline: 'Vic Spencer dropped his album Trees Are Undefeated',
      summary: 'A sharp, gritty hip-hop release from the Chicago veteran.',
    },
  ],
  news: [
    {
      headline: 'NYC Mayor Eric Adams ends re-election campaign',
      summary: 'The announcement reshapes the New York City mayoral race.',
    },
    {
      headline: 'US federal government edged closer to a shutdown',
      summary:
        'Congressional leaders failed to reach agreement during a high-level White House meeting.',
    },
  ],
  movies: [
    {
      headline: 'A24’s latest tops the weekend box office',
      summary: 'The indie hit beat two franchise sequels on its opening weekend.',
    },
  ],
  design: [
    {
      headline: 'Serpentine Pavilion unveils this year’s design',
      summary: 'The annual commission spotlights sustainable materials.',
    },
  ],
  travel: [
    {
      headline: 'New high-speed rail route opens for booking',
      summary: 'The line cuts the intercity trip to under three hours.',
    },
  ],
  books: [
    {
      headline: 'This week’s surprise bestseller',
      summary: 'A debut novel climbs the charts after a viral review.',
    },
  ],
};

function fallbackFeed(date: Date, topics: Topic[]): TopicItem[] {
  const variant = date.getDate() % 2;
  return topics.map((t) => {
    const options = FALLBACKS[t.key];
    const pick = options[variant % options.length];
    return { topic: t.key, label: t.label, ...pick, live: false };
  });
}

// ---- Internet fetch via OpenAI web search ----

function apiKey(): string | undefined {
  const key = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
  return key && key.trim().length > 10 ? key.trim() : undefined;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Search models sometimes decorate output with markdown bold, links, and
// citation URLs — strip all of it down to plain readable text.
function cleanText(s: string): string {
  return s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // [label](url) → label
    .replace(/\(?https?:\/\/\S+\)?/g, '') // bare URLs
    .replace(/\(\s*[a-z0-9-]+(\.[a-z0-9-]+)+\s*\)/gi, '') // (source.com) citations
    .replace(/\*\*/g, '')
    .replace(/\(\s*\)/g, '') // empty parens left behind
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Cached items may predate the cleaner (or a stricter version of it).
function cleanItem(i: TopicItem): TopicItem {
  return { ...i, headline: cleanText(i.headline), summary: cleanText(i.summary) };
}

// Models hallucinate image URLs, but they cite article URLs accurately —
// so we fetch the article and read its real og:image (the photo shown when
// the article is shared). Best-effort with a short timeout; native has no
// CORS so this works well on device.
async function ogImage(articleUrl: unknown): Promise<string | undefined> {
  if (typeof articleUrl !== 'string' || !/^https:\/\/\S+$/.test(articleUrl.trim())) {
    return undefined;
  }
  if (/example\.com/i.test(articleUrl)) return undefined;
  try {
    const res = (await Promise.race([
      fetch(articleUrl.trim(), { headers: { Accept: 'text/html' } }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ])) as Response;
    if (!res.ok) return undefined;
    const html = await res.text();
    const m =
      html.match(/property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ??
      html.match(/content=["']([^"']+)["'][^>]*property=["']og:image["']/i) ??
      html.match(/name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i);
    const url = m?.[1];
    return url && /^https:\/\//.test(url) ? url : undefined;
  } catch {
    return undefined;
  }
}

// Resolve article URLs → real photos for a batch of items, in parallel.
async function withImages<T extends { source?: unknown }>(
  items: (T & TopicItem)[],
): Promise<TopicItem[]> {
  return Promise.all(
    items.map(async (i) => {
      const image = await ogImage(i.source);
      const { source: _source, ...item } = i;
      return { ...item, image };
    }),
  );
}

async function fetchFromInternet(
  date: Date,
  topics: Topic[],
  interests: Partial<Record<TopicKey, string>>,
): Promise<TopicItem[] | null> {
  const key = apiKey();
  if (!key) return null;

  const dateLabel = `${MONTH_NAMES[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  const topicLines = topics
    .map((t) => {
      const taste = interests[t.key];
      return `- "${t.key}": ${t.query}${taste ? ` — the user especially cares about: ${taste}; prefer events about those, but if that date has none, give the most notable general event for the topic instead (never report "no events")` : ''}`;
    })
    .join('\n');
  const prompt = `Search the web for what happened on ${dateLabel} (or the closest coverage of that date) for each topic below. For each topic give one real event from that date.\n${topicLines}\n\nRespond with ONLY a JSON object, no other text, in this exact shape:\n{"items":[{"topic":"<topic key>","headline":"<short bold headline, max 12 words>","summary":"<1-2 sentences, max 30 words>","source":"<the real URL of the news article this came from>"}]}`;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-5-search-api',
        web_search_options: { search_context_size: 'low' },
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const content: string = json.choices?.[0]?.message?.content ?? '';
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as {
      items?: { topic?: string; headline?: string; summary?: string; source?: string | null }[];
    };
    if (!parsed.items?.length) return null;

    const mapped = topics.map((t) => {
      const found = parsed.items!.find((i) => i.topic === t.key && i.headline);
      return found
        ? {
            topic: t.key,
            label: t.label,
            headline: cleanText(found.headline!),
            summary: cleanText(found.summary ?? ''),
            source: found.source,
            live: true,
          }
        : { ...fallbackFeed(date, [t])[0], source: undefined };
    });
    return withImages(mapped);
  } catch {
    return null;
  }
}

// ---- Cache-first day feed ----

const CACHE_PREFIX = 'otdFeed-';

// Signature of "what would change the results" — topic mix plus the user's
// per-topic taste text. A cache from a different signature is stale.
function feedSignature(topics: Topic[], interests: Partial<Record<TopicKey, string>>): string {
  return tinyHash(topics.map((t) => `${t.key}:${interests[t.key] ?? ''}`).join('|'));
}

export async function getDayFeed(date: Date, topics: Topic[]): Promise<TopicItem[]> {
  const interests = await getTopicInterests();
  const sig = feedSignature(topics, interests);
  const cacheId = `${CACHE_PREFIX}${dateKey(date)}`;
  try {
    const cached = await AsyncStorage.getItem(cacheId);
    if (cached) {
      const parsed = JSON.parse(cached) as { items: TopicItem[]; sig?: string };
      // Only reuse the cache when it matches the user's current topics AND
      // taste (fallback content is cheap to regenerate).
      if (
        parsed.sig === sig &&
        parsed.items.some((i) => i.live) &&
        topics.every((t) => parsed.items.some((i) => i.topic === t.key))
      ) {
        return topics.map((t) => {
          const found = parsed.items.find((i) => i.topic === t.key);
          return found ? cleanItem(found) : fallbackFeed(date, [t])[0];
        });
      }
    }
  } catch {
    // fall through to fetch
  }

  const live = await fetchFromInternet(date, topics, interests);
  if (live) {
    AsyncStorage.setItem(cacheId, JSON.stringify({ items: live, sig })).catch(() => {});
    return live;
  }
  return fallbackFeed(date, topics);
}

// ---- Expanded topic: several events from one topic on one day ----

const EVENTS_CACHE_PREFIX = 'otdEvents-';
const EVENTS_COUNT = 4;

// Up to 4 real events for a single topic on a given day, steered by the
// user's taste text — powers the expanded, swipeable view of a topic card.
export async function getTopicEvents(date: Date, topic: Topic): Promise<TopicItem[]> {
  const interests = await getTopicInterests();
  const taste = interests[topic.key] ?? '';
  const cacheId = `${EVENTS_CACHE_PREFIX}${dateKey(date)}-${topic.key}-${tinyHash(taste)}`;

  try {
    const cached = await AsyncStorage.getItem(cacheId);
    if (cached) {
      const parsed = JSON.parse(cached) as { items: TopicItem[] };
      if (parsed.items.length > 0) return parsed.items.map(cleanItem);
    }
  } catch {
    // fall through to fetch
  }

  const key = apiKey();
  if (key) {
    const dateLabel = `${MONTH_NAMES[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
    const prompt = `Search the web for ${EVENTS_COUNT} DISTINCT real events that happened on ${dateLabel} (or the closest coverage of that date) in this topic: ${topic.query}.${
      taste ? ` The user especially cares about: ${taste} — lead with events about those, then fill the rest with other notable ones from the same topic (never report "no events").` : ''
    } Aim for exactly ${EVENTS_COUNT} items covering different competitions, artists, or angles — return fewer only if that date genuinely had fewer. No URLs or citations in the headline/summary text.\n\nRespond with ONLY a JSON object, no other text, in this exact shape:\n{"items":[{"headline":"<short bold headline, max 12 words>","summary":"<1-2 sentences, max 30 words>","source":"<the real URL of the news article this came from>"}]}`;

    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-5-search-api',
          // The expanded view is fetched one topic at a time, so it can
          // afford a wider search than the multi-topic day feed.
          web_search_options: { search_context_size: 'medium' },
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (res.ok) {
        const json = await res.json();
        const content: string = json.choices?.[0]?.message?.content ?? '';
        const match = content.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]) as {
            items?: { headline?: string; summary?: string; source?: string | null }[];
          };
          const mapped = (parsed.items ?? [])
            .filter((i) => i.headline)
            .slice(0, EVENTS_COUNT)
            .map((i) => ({
              topic: topic.key,
              label: topic.label,
              headline: cleanText(i.headline!),
              summary: cleanText(i.summary ?? ''),
              source: i.source,
              live: true,
            }));
          if (mapped.length > 0) {
            const items = await withImages(mapped);
            AsyncStorage.setItem(cacheId, JSON.stringify({ items })).catch(() => {});
            return items;
          }
        }
      }
    } catch {
      // fall through to fallback
    }
  }

  // Offline/no-credits fallback: the topic's seeded items.
  return FALLBACKS[topic.key].map((f) => ({
    topic: topic.key,
    label: topic.label,
    ...f,
    live: false,
  }));
}
