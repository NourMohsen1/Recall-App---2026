// The Ask tab never shows a screen of its own: tapping it opens the chat
// (app/chat.tsx) — see the tab's listener in _layout.tsx. This file exists
// because every tab needs a route.
export default function AskTab() {
  return null;
}
