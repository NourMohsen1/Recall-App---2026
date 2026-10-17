// Live voice, end to end, without a phone: the app's own session settings,
// instructions, tools and lookups; speech in from recordings, answers out.
import { REALTIME_TOOLS, buildVoiceBootstrap, runRealtimeTool } from '@app/realtimeTools';
import { sessionSettings } from '@app/realtimeVoice';
import { createTurnTaker } from '@app/turnTaking';
import { getVoicePrefs } from '@app/voicePrefs';
const fs = require('fs');
const LAB = process.env.VOICE_LAB_DIR + '/';
type Step = { audio?: string; text?: string; interrupt?: string; label: string };
const scenario: Step[] = JSON.parse(fs.readFileSync(LAB + 'scenarios/' + process.env.SCENARIO, 'utf8'));
(async () => {
  const r = await fetch('https://recall-keys.nourmohsen-recall.workers.dev/realtime/token', { method: 'POST', headers: { authorization: `Bearer ${process.env.EXPO_PUBLIC_RECALL_APP_TOKEN}` } });
  const key = ((await r.json()) as any).value;
  const ws = new (globalThis as any).WebSocket('wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1', ['realtime', 'openai-insecure-api-key.' + key]);
  const send = (o: any) => ws.send(JSON.stringify(o));
  // The app's own turn-taking: it starts every answer (Recall is quiet
  // between turns here, so nothing overlaps).
  const turns = createTurnTaker({ send, setVolume: () => {}, log: (l) => console.log('   ' + l) });
  let responding = false;
  let resolveTurn: ((s: string) => void) | null = null;
  let spoke = false; let onFirstAudio: (() => void) | null = null;
  const tools: string[] = [];
  ws.onmessage = async (m: any) => {
    const e = JSON.parse(m.data);
    turns.onEvent(e);
    if (e.type === 'response.created') responding = true;
    if (e.type === 'error' && e.error.code !== 'response_cancel_not_active') console.log('   ERROR', e.error.message);
    if (e.type === 'conversation.item.input_audio_transcription.completed') console.log(`   heard: ${e.transcript.trim()}`);
    if (e.type === 'response.output_audio.delta' && !spoke) { spoke = true; onFirstAudio?.(); }
    if (e.type === 'response.output_audio_transcript.done') console.log(`   RECALL: ${e.transcript}`);
    if (e.type === 'response.done') {
      responding = false;
      if (e.response.status === 'cancelled') { console.log('   (answer cut off by the user)'); return; }
      const calls = (e.response.output ?? []).filter((o: any) => o.type === 'function_call');
      if (calls.length) {
        for (const c of calls) {
          tools.push(c.name);
          const out = await runRealtimeTool(c.name, JSON.parse(c.arguments || '{}')).catch((x: any) => ({ error: String(x) }));
          send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: c.call_id, output: JSON.stringify(out) } });
        }
        if (tools.length) console.log(`   (looked up: ${calls.map((c: any) => c.name + ' ' + c.arguments).join(', ').slice(0, 160)})`);
        if (responding || turns.userTookTurn()) return;
        send({ type: 'conversation.item.create', item: { type: 'message', role: 'system', content: [{ type: 'input_text', text: 'You already said your short filler for this question. Now either answer, or call another tool without saying anything first.' }] } });
        send({ type: 'response.create' });
        return;
      }
      resolveTurn?.('done');
    }
  };
  await new Promise((s) => (ws.onopen = s));
  const voice = ((process.env.VOICE as any) || (await getVoicePrefs()).voice);
  send({ type: 'session.update', session: { ...sessionSettings((process.env.LANG_PICK as any) || 'auto', await buildVoiceBootstrap(), voice), tools: REALTIME_TOOLS, tool_choice: 'auto' } });
  await new Promise((s) => setTimeout(s, 1000));
  const stream = async (file: string) => {
    const pcm = fs.readFileSync(LAB + 'audio/' + file); const CH = 4800;
    for (let i = 0; i < pcm.length; i += CH) { send({ type: 'input_audio_buffer.append', audio: pcm.subarray(i, i + CH).toString('base64') }); await new Promise((s) => setTimeout(s, 100)); }
    for (let i = 0; i < 15; i++) { send({ type: 'input_audio_buffer.append', audio: Buffer.alloc(CH).toString('base64') }); await new Promise((s) => setTimeout(s, 100)); }
  };
  for (const st of scenario) {
    console.log(`\n== ${st.label}`);
    spoke = false; tools.length = 0;
    const done = new Promise<string>((s) => (resolveTurn = s));
    if (st.text) {
      console.log(`   said (typed): ${st.text}`);
      send({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: st.text }] } });
      send({ type: 'response.create' });
    } else if (st.audio) {
      if (st.interrupt) onFirstAudio = () => { onFirstAudio = null; setTimeout(() => { console.log('   >> user talks over Recall'); void stream(st.interrupt!); }, 700); };
      await stream(st.audio);
    }
    await Promise.race([done, new Promise((s) => setTimeout(s, 40000))]);
    if (process.env.SHOW_PREFS) console.log('   prefs now:', JSON.stringify((await getVoicePrefs()).notes.map((n) => n.text)));
    await new Promise((s) => setTimeout(s, 1200));
  }
  ws.close(); process.exit(0);
})();
