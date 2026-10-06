import AsyncStorage from '@react-native-async-storage/async-storage';
import { chatCompletion, textProviders } from './aiProviders';
import { isSafeWebImage, SAFE_SEARCH_RULE } from './contentSafety';
import { getFollows } from './follows';
import { dateKey } from './memoryLog';

// "On This Day" feed: for each past day, pull what happened in the world in
// the user's interest areas (chosen in the onboarding quiz, defaulting to
// Sports / Music / News). Content is fetched from the internet via OpenAI's
// web-search model, cached per day, and falls back to seeded demo items when
// no API key/credits are available.

/** A built-in topic ('sports') or one the user typed ('custom-…'). */
export type TopicKey = string;

/** `icon` is a MaterialCommunityIcons name. */
export type Topic = { key: TopicKey; label: string; query: string; icon: string };

export type TopicItem = {
  topic: TopicKey;
  label: string;
  headline: string;
  summary: string;
  live: boolean; // true when fetched from the internet, false for seeded demo
  /** Set when the news is from a nearby day rather than this one:
   *  "2 days before", "the day after". */
  when?: string;
  image?: string; // direct URL to a related news photo, when the search found one
  /** The photo passed the on-device nudity check (contentSafety.ts). */
  imageChecked?: boolean;
};

// Keyed by the label the setup question shows (quizAnswers[0] holds labels).
const ALL_TOPICS: Record<string, Topic> = {
  News: { key: 'news', label: 'News', icon: 'newspaper-variant-outline', query: 'a major general news story or trending world event' },
  'World Events': { key: 'news', label: 'News', icon: 'newspaper-variant-outline', query: 'a major world news story or trending event' },
  Sports: { key: 'sports', label: 'Sports', icon: 'soccer', query: 'a major sports result (like a football/soccer match score or big game)' },
  Music: { key: 'music', label: 'Music', icon: 'music-note', query: 'a notable music release, chart record, or trending song/album' },
  Movies: { key: 'movies', label: 'Movies', icon: 'movie-open-outline', query: 'a notable movie release, box office story, or entertainment event' },
  'TV Shows': { key: 'tv', label: 'TV Shows', icon: 'television-classic', query: 'a notable TV series premiere, finale, or streaming hit' },
  Books: { key: 'books', label: 'Books', icon: 'book-open-variant', query: 'a notable book release or literary story' },
  Design: { key: 'design', label: 'Design', icon: 'palette-outline', query: 'a notable design or architecture story' },
  Art: { key: 'art', label: 'Art', icon: 'brush-variant', query: 'a notable art exhibition, auction, or artist story' },
  Technology: { key: 'tech', label: 'Technology', icon: 'cellphone', query: 'a notable technology launch, product announcement, or tech industry story' },
  Science: { key: 'science', label: 'Science', icon: 'atom', query: 'a notable science discovery, space mission, or research breakthrough' },
  Food: { key: 'food', label: 'Food', icon: 'silverware-fork-knife', query: 'a notable food, restaurant, or cooking story' },
  Travel: { key: 'travel', label: 'Travel', icon: 'airplane', query: 'a notable travel or destination story' },
  Fashion: { key: 'fashion', label: 'Fashion', icon: 'tshirt-crew-outline', query: 'a notable fashion show, collection launch, or fashion industry story' },
  Gaming: { key: 'gaming', label: 'Gaming', icon: 'gamepad-variant-outline', query: 'a notable video game release, esports result, or gaming story' },
  Business: { key: 'business', label: 'Business', icon: 'chart-line', query: 'a notable business, markets, or company story' },
  'Health & Fitness': { key: 'health', label: 'Health & Fitness', icon: 'heart-pulse', query: 'a notable health, wellness, or fitness story' },
  Nature: { key: 'nature', label: 'Nature', icon: 'leaf', query: 'a notable nature, wildlife, or climate story' },
  Cars: { key: 'cars', label: 'Cars', icon: 'car-sports', query: 'a notable car launch, motorsport result, or automotive story' },
};

/** The chips the setup question offers, in order. */
export const TOPIC_LABELS = Object.keys(ALL_TOPICS).filter((l) => l !== 'World Events');

/** A topic's icon, for any key — typed topics get a star. */
export function topicIcon(key: TopicKey): string {
  if (key.startsWith('custom-')) return 'star-four-points-outline';
  return Object.values(ALL_TOPICS).find((t) => t.key === key)?.icon ?? 'earth';
}

// ---- Topics the user typed ("Other") ----
// Only ever stored after checkTopic() (contentSafety.ts) said yes.

const CUSTOM_KEY = 'otdCustomTopics';

function customTopic(label: string): Topic {
  const slug = label.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'topic';
  return {
    key: `custom-${slug}`,
    label,
    icon: 'star-four-points-outline',
    query: `a notable news story about "${label}"`,
  };
}

export async function getCustomTopics(): Promise<Topic[]> {
  try {
    const raw = await AsyncStorage.getItem(CUSTOM_KEY);
    return raw ? (JSON.parse(raw) as string[]).map(customTopic) : [];
  } catch {
    return [];
  }
}

/** Saves typed topics the safety check has already accepted. */
export async function saveCustomTopics(labels: string[]): Promise<void> {
  const clean = [...new Set(labels.map((l) => l.trim()).filter(Boolean))];
  await AsyncStorage.setItem(CUSTOM_KEY, JSON.stringify(clean));
}

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
    const custom = await getCustomTopics();
    const picked = (answers[0] ?? [])
      .map((label) => ALL_TOPICS[label] ?? custom.find((c) => c.label === label))
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
      const custom = await getCustomTopics();
      const topics = keys
        .map((k) => TOPIC_OPTIONS.find((t) => t.key === k) ?? custom.find((t) => t.key === k))
        .filter(Boolean) as Topic[];
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

// ---- What the user follows inside each topic ----
// "Al Ahly, Premier League, F1" — learned from their memories and added by
// them (src/follows.ts). Joined per topic, it steers the search, and it is
// part of the cache signature, so a change refetches.

export async function getTopicInterests(): Promise<Partial<Record<TopicKey, string>>> {
  const out: Partial<Record<TopicKey, string>> = {};
  for (const f of await getFollows()) out[f.topic] = out[f.topic] ? `${out[f.topic]}, ${f.name}` : f.name;
  return out;
}

/** The search instruction for one topic: its follows only when it has
 *  some, with the nearest day allowed and labelled — never general news in
 *  their place, which would mean nothing to this user. */
function followedLine(t: Topic, taste: string | undefined): string {
  if (!taste) return t.query;
  return `news about ONLY these, which the user follows: ${taste}. If none of them had news on that exact date, use the closest news about them from up to 3 days before or after, and say how far off in "when". If there is nothing within 3 days, leave this topic out. Never use general ${t.label} news instead`;
}

// Tiny stable hash so caches invalidate when the user's taste text changes.
function tinyHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

// ---- Seeded fallback content (used when the internet fetch is unavailable) ----

const FALLBACKS: Record<string, { headline: string; summary: string }[]> = {
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

// Topics without seeded items say what they are waiting for, rather than
// borrowing another topic's demo headline.
function fallbackFor(t: Topic): { headline: string; summary: string }[] {
  return (
    FALLBACKS[t.key] ?? [{ headline: `${t.label} news didn’t load`, summary: 'Recall will try again the next time you open this day.' }]
  );
}

function fallbackFeed(date: Date, topics: Topic[]): TopicItem[] {
  const variant = date.getDate() % 2;
  return topics.map((t) => {
    const options = fallbackFor(t);
    const pick = options[variant % options.length];
    return { topic: t.key, label: t.label, ...pick, live: false };
  });
}

import { backendToken, backendUrl, ENDPOINTS } from './backend';
// ---- Internet fetch via OpenAI web search ----

// The app's own server holds the provider key; this is only what gets the
// app through its door. See src/backend.ts.
function apiKey(): string | undefined {
  return backendToken();
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

// "2 days before" — or nothing when the model says it was that very day.
function cleanWhen(w: unknown): string | undefined {
  if (typeof w !== 'string') return undefined;
  const t = cleanText(w).replace(/[.]$/, '');
  return t && !/^(same day|on that date|that day|that date|0 days?|none|n\/a)$/i.test(t) ? t : undefined;
}

function notLoadedItem(t: Topic): TopicItem {
  return {
    topic: t.key,
    label: t.label,
    headline: 'Didn’t load this time',
    summary: 'Recall will try again the next time you open this day.',
    live: false,
  };
}

function quietItem(t: Topic, taste: string): TopicItem {
  return {
    topic: t.key,
    label: t.label,
    headline: 'Quiet around this day',
    summary: `Nothing about ${taste} within a few days of this date.`,
    live: true,
  };
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
  let found = 0;
  const out = await Promise.all(
    items.map(async (i) => {
      const url = await ogImage(i.source);
      if (url) found++;
      // Shown only once the phone has read it and found nothing explicit.
      const image = url && (await isSafeWebImage(url)) ? url : undefined;
      const { source: _source, ...item } = i;
      return { ...item, image, imageChecked: true };
    }),
  );
  console.log(`[safety] news photos: ${out.filter((i) => i.image).length} of ${found} kept`);
  return out;
}

// ---- Real news, found by Tavily and written up by DeepSeek ----
// The search happens on Recall's server (/search/news); DeepSeek then picks
// and writes each card from those articles only — it is never asked to
// recall news itself, because what it "remembers" about a date it often
// invents (measured: a match score that never happened), and it knows
// nothing after 2024. Cheaper than OpenAI's search model, and without its
// one-search-a-minute limit. If the server's search is unavailable, the
// older OpenAI search below is used instead, so a card is never empty
// because of this.

type Hit = { title: string; url: string; content: string; published: string | null };

function shift(date: Date, days: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return dateKey(d);
}

/** Null when the search itself is unavailable (no key, server error) —
 *  distinct from an empty list, which means "searched, found nothing". */
async function newsSearch(query: string, from: string, to: string, max: number): Promise<Hit[] | null> {
  const key = apiKey();
  const url = backendUrl('/search/news');
  if (!key || !url) return null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, from, to, max }),
    });
    if (!res.ok) {
      console.warn(`[otd] news search failed: HTTP ${res.status}`);
      return null;
    }
    return ((await res.json()) as { results?: Hit[] }).results ?? [];
  } catch (e) {
    console.warn('[otd] news search failed:', e);
    return null;
  }
}

/** Articles for one topic around a date: one search per thing the user
 *  follows (most relevant by far — one combined query brought back noise),
 *  or one general search for a topic they don't follow anything in. */
async function topicHits(date: Date, t: Topic, taste: string | undefined, perFollow: number, maxFollows: number): Promise<Hit[] | null> {
  const follows = (taste ?? '').split(',').map((f) => f.trim()).filter(Boolean).slice(0, maxFollows);
  // News is often published the day after; followed topics may also use
  // the nearest day within three.
  const from = shift(date, follows.length ? -3 : -1);
  const to = shift(date, follows.length ? 3 : 1);
  const queries = follows.length ? follows.map((f) => `${f} news`) : [`${t.label} news`];
  const lists = await Promise.all(queries.map((q) => newsSearch(q, from, to, perFollow)));
  if (lists.every((l) => l === null)) return null;
  const seen = new Set<string>();
  const hits: Hit[] = [];
  for (const h of lists.flatMap((l) => l ?? [])) {
    if (!h.url || seen.has(h.url)) continue;
    seen.add(h.url);
    hits.push(h);
  }
  return hits;
}

function hitsBlock(hits: Hit[]): string {
  return hits
    .map((h, i) => `[${i + 1}] ${h.published ? `(${h.published.slice(0, 16)}) ` : ''}${h.title}\nURL: ${h.url}\n${h.content}`)
    .join('\n\n');
}

const WRITE_PROMPT = `You write the cards of "On This Day" in Recall, a personal memory app: real news from a date in the user's life, about the things they follow. You are given search results — real articles — for each topic.

Use ONLY the given results. Never add facts, scores, names or dates that are not in them. Pick the most notable event that happened on the target date. A topic marked FOLLOWS may use the closest event about what they follow within 3 days, and must then say how far off in "when" ("2 days before", "the day after"); otherwise "when" is empty. If a topic's results contain nothing usable — off-topic, ads, betting tips, or nothing near the date — leave that topic out entirely. ${SAFE_SEARCH_RULE}

headline: at most 12 words. summary: one or two sentences, at most 30 words. source: the URL of the result you used, copied exactly.`;

async function writeCards(
  date: Date,
  blocks: { t: Topic; taste?: string; hits: Hit[] }[],
  perTopic: number,
): Promise<Map<string, { headline: string; summary: string; when?: string; source?: string }[]>> {
  const out = new Map<string, { headline: string; summary: string; when?: string; source?: string }[]>();
  const usable = blocks.filter((b) => b.hits.length > 0);
  if (usable.length === 0) return out;
  const dateLabel = `${MONTH_NAMES[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
  const body = usable
    .map(
      (b) =>
        `### TOPIC "${b.t.key}" — ${b.t.label}${b.taste ? ` — FOLLOWS: ${b.taste}` : ''}\n${hitsBlock(b.hits.slice(0, 10))}`,
    )
    .join('\n\n');
  const shape =
    perTopic === 1
      ? '{"items":[{"topic":"<topic key>","headline":"...","summary":"...","when":"","source":"<url>"}]} — at most one item per topic'
      : `{"items":[{"topic":"<topic key>","headline":"...","summary":"...","when":"","source":"<url>"}]} — up to ${perTopic} DISTINCT events, about different things where possible`;
  const result = await chatCompletion(textProviders(), (model) => ({
    model,
    messages: [
      { role: 'system', content: WRITE_PROMPT },
      { role: 'user', content: `Target date: ${dateLabel}.\n\n${body}\n\nRespond with ONLY JSON: ${shape}` },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
  }));
  if (!result.ok) {
    console.warn(`[otd] could not write cards: HTTP ${result.status}`);
    return out;
  }
  try {
    const parsed = JSON.parse(result.content) as {
      items?: { topic?: string; headline?: string; summary?: string; when?: string; source?: string }[];
    };
    for (const b of usable) {
      const urls = new Set(b.hits.map((h) => h.url));
      const items = (parsed.items ?? [])
        .filter((i) => i.topic === b.t.key && i.headline)
        .slice(0, perTopic)
        .map((i) => ({
          headline: cleanText(i.headline!),
          summary: cleanText(i.summary ?? ''),
          when: cleanWhen(i.when),
          // Only a URL that really was in the results — never one it made up.
          source: i.source && urls.has(i.source) ? i.source : undefined,
        }));
      if (items.length) out.set(b.t.key, items);
    }
  } catch {
    console.warn('[otd] the written cards were not JSON');
  }
  return out;
}

/** The day feed from real articles. Null when search is unavailable, so
 *  the caller can fall back to OpenAI's search. */
async function fetchFromNews(
  date: Date,
  topics: Topic[],
  interests: Partial<Record<TopicKey, string>>,
): Promise<TopicItem[] | null> {
  const found = await Promise.all(topics.map((t) => topicHits(date, t, interests[t.key], 4, 2)));
  if (found.every((h) => h === null)) return null;
  const cards = await writeCards(
    date,
    topics.map((t, i) => ({ t, taste: interests[t.key], hits: found[i] ?? [] })),
    1,
  );
  const items = topics.map((t) => {
    const card = cards.get(t.key)?.[0];
    if (card) return { topic: t.key, label: t.label, ...card, live: true };
    // Searched, nothing worth showing: say so rather than show a demo item.
    return interests[t.key]
      ? { ...quietItem(t, interests[t.key]!), source: undefined }
      : { topic: t.key, label: t.label, headline: `Quiet day for ${t.label}`, summary: 'Nothing notable turned up around this date.', live: true, source: undefined };
  });
  console.log(`[otd] ${dateKey(date)}: ${cards.size} of ${topics.length} topics from real articles`);
  return withImages(items);
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
      return `- "${t.key}": ${followedLine(t, interests[t.key])}`;
    })
    .join('\n');
  const prompt = `Search the web for what happened on ${dateLabel} (or the closest coverage of that date) for each topic below. For each topic give one real event from that date. ${SAFE_SEARCH_RULE}\n${topicLines}\n\nRespond with ONLY a JSON object, no other text, in this exact shape:\n{"items":[{"topic":"<exactly one of the quoted topic keys above>","headline":"<short bold headline, max 12 words>","summary":"<1-2 sentences, max 30 words>","when":"<empty if it happened on that date, else how far off, e.g. 2 days before>","source":"<the real URL of the news article this came from>"}]}`;

  try {
    const res = await fetch(backendUrl(ENDPOINTS.openAiChat) ?? '', {
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
      items?: { topic?: string; headline?: string; summary?: string; when?: string; source?: string | null }[];
    };
    if (!parsed.items) return null;

    // The model sometimes labels an item with what it's about ("Premier
    // League") instead of the topic key ("sports"): matched by label or by
    // a follow too, or a found item would read as "quiet".
    const belongs = (i: { topic?: string }, t: Topic) => {
      const said = (i.topic ?? '').trim().toLowerCase();
      if (!said) return false;
      if (said === t.key || said === t.label.toLowerCase()) return true;
      return (interests[t.key] ?? '')
        .split(',')
        .some((f) => f.trim().toLowerCase() === said);
    };
    const mapped = topics.map((t) => {
      const found = parsed.items!.find((i) => i.headline && belongs(i, t));
      if (found) {
        return {
          topic: t.key,
          label: t.label,
          headline: cleanText(found.headline!),
          summary: cleanText(found.summary ?? ''),
          when: cleanWhen(found.when),
          source: found.source,
          live: true,
        };
      }
      // A topic with follows and nothing about them near this day says so,
      // rather than showing another topic's demo headline.
      return interests[t.key] ? { ...quietItem(t, interests[t.key]!), source: undefined } : { ...fallbackFeed(date, [t])[0], source: undefined };
    });
    return withImages(mapped);
  } catch {
    return null;
  }
}

// ---- Cache-first day feed ----

// Items cached before news photos were checked get checked now, once, and
// the cache is rewritten so it never has to happen again.
async function checkCachedImages(items: TopicItem[], save: (items: TopicItem[]) => void): Promise<TopicItem[]> {
  if (items.every((i) => !i.image || i.imageChecked)) return items;
  const out = await Promise.all(
    items.map(async (i) =>
      !i.image || i.imageChecked
        ? i
        : { ...i, image: (await isSafeWebImage(i.image)) ? i.image : undefined, imageChecked: true },
    ),
  );
  console.log(
    `[safety] cached news photos checked: ${out.filter((i) => i.image).length} of ${items.filter((i) => i.image).length} kept`,
  );
  save(out);
  return out;
}

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
      parsed.items = await checkCachedImages(parsed.items, (items) =>
        AsyncStorage.setItem(cacheId, JSON.stringify({ ...parsed, items })).catch(() => {}),
      );
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

  const live = (await fetchFromNews(date, topics, interests)) ?? (await fetchFromInternet(date, topics, interests));
  if (live) {
    AsyncStorage.setItem(cacheId, JSON.stringify({ items: live, sig })).catch(() => {});
    return live;
  }
  return topics.map((t) => (interests[t.key] ? notLoadedItem(t) : fallbackFeed(date, [t])[0]));
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
      if (parsed.items.length > 0) {
        const items = await checkCachedImages(parsed.items, (checked) =>
          AsyncStorage.setItem(cacheId, JSON.stringify({ items: checked })).catch(() => {}),
        );
        return items.map(cleanItem);
      }
    }
  } catch {
    // fall through to fetch
  }

  // Real articles first (up to four searches, one per follow).
  const hits = await topicHits(date, topic, taste || undefined, 4, EVENTS_COUNT);
  if (hits) {
    const cards = (await writeCards(date, [{ t: topic, taste: taste || undefined, hits }], EVENTS_COUNT)).get(topic.key);
    if (!cards?.length) return taste ? [quietItem(topic, taste)] : [];
    const items = await withImages(cards.map((c) => ({ topic: topic.key, label: topic.label, ...c, live: true })));
    AsyncStorage.setItem(cacheId, JSON.stringify({ items })).catch(() => {});
    return items;
  }

  const key = apiKey();
  if (key) {
    const dateLabel = `${MONTH_NAMES[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
    const prompt = `Search the web for ${EVENTS_COUNT} DISTINCT real events that happened on ${dateLabel} (or the closest coverage of that date) in this topic: ${
      taste
        ? `${topic.label} — ${followedLine(topic, taste)}. Spread the items across what they follow (one about each, where there is one)`
        : topic.query
    }. Aim for exactly ${EVENTS_COUNT} items covering different competitions, artists, or angles — return fewer only if that date genuinely had fewer. No URLs or citations in the headline/summary text. ${SAFE_SEARCH_RULE}\n\nRespond with ONLY a JSON object, no other text, in this exact shape:\n{"items":[{"headline":"<short bold headline, max 12 words>","summary":"<1-2 sentences, max 30 words>","when":"<empty if it happened on that date, else how far off, e.g. 2 days before>","source":"<the real URL of the news article this came from>"}]}`;

    try {
      const res = await fetch(backendUrl(ENDPOINTS.openAiChat) ?? '', {
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
            items?: { headline?: string; summary?: string; when?: string; source?: string | null }[];
          };
          const mapped = (parsed.items ?? [])
            .filter((i) => i.headline)
            .slice(0, EVENTS_COUNT)
            .map((i) => ({
              topic: topic.key,
              label: topic.label,
              headline: cleanText(i.headline!),
              summary: cleanText(i.summary ?? ''),
              when: cleanWhen(i.when),
              source: i.source,
              live: true,
            }));
          // Searched, and nothing about what they follow near this day.
          if (mapped.length === 0 && taste) return [quietItem(topic, taste)];
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

  // Offline or no credits: a followed topic says it hasn't loaded; others
  // show their seeded items.
  if (taste) return [notLoadedItem(topic)];
  return fallbackFor(topic).map((f) => ({
    topic: topic.key,
    label: topic.label,
    ...f,
    live: false,
  }));
}
