// The word test on its own: what each phrase said over Recall should do.
import { judge } from '@app/turnTaking';
const cases: [string, string][] = [
  ['آه', 'backchannel'], ['اه اه', 'backchannel'], ['ممم، تمام', 'backchannel'], ['Mmm, تمام', 'backchannel'], ['أيوه، معاك', 'backchannel'],
  ['آآآآه', 'backchannel'], ['yeah', 'backchannel'], ['ok got it', 'backchannel'], ['Ah.', 'backchannel'], ['', 'backchannel'],
  ['لا استنى، أنا قصدي حاجة تانية', 'interrupt'], ['استنى ثانية', 'interrupt'], ['استنى تانية.', 'interrupt'], ['wait', 'interrupt'],
  ['آه بس أنا مش قصدي كده', 'interrupt'], ['مين علي ده؟', 'interrupt'], ['طيب وبعدين', 'interrupt'], ['hold on', 'interrupt'],
  ['I mean the other one', 'interrupt'], ['لأ', 'interrupt'], ['yeah yeah yeah ok sure right', 'interrupt'],
];
let bad = 0;
for (const [t, want] of cases) { const got = judge(t, true); if (got !== want) bad++; console.log(`${got === want ? 'ok ' : 'BAD'} ${want.padEnd(11)} "${t}"`); }
console.log(`\n${cases.length - bad}/${cases.length} right`);
