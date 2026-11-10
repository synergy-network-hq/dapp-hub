# Jarvis React

One reusable React package for the animated Jarvis companion and chat. The Portal repositories include source snapshots of this package; this repository is the standalone component source. There are no Tauri or Portal imports in this package. The original supplied artwork is bundled locally, with no image CDN or runtime service dependency.

## Development

```sh
git clone https://github.com/synergy-network-hq/jarvis-react.git
cd jarvis-react
pnpm install --frozen-lockfile
pnpm test
```

Requires Node.js, pnpm and a React 18+ host. This repository is private and is not published to npm.

## Install On A Website

Run `npm pack` in this directory, then install the resulting package in a React 18+ application:

```sh
npm install /path/to/synergy-network-jarvis-react-0.4.0.tgz @tabler/icons-react
```

This is a source package for JSX-capable bundlers such as Vite. For a local linked dependency, configure Vite `resolve.dedupe: ['react', 'react-dom', '@tabler/icons-react']` so the host owns the React instance. Next.js App Router consumers should put the widget in a `"use client"` component and include `@synergy-network/jarvis-react` in `transpilePackages`. Import the namespaced styles explicitly in the host entry point as `@synergy-network/jarvis-react/styles.css` when global CSS must be imported in the host entry point. Inactive legacy sprite assets use standard `new URL(..., import.meta.url)` bundling. Mount `JarvisWidget` once per page.

```jsx
import {JarvisWidget} from '@synergy-network/jarvis-react';
import '@synergy-network/jarvis-react/styles.css';

export function Assistant() {
  return <JarvisWidget
    storageKey="my-site-jarvis"
    accent="#47cfff"
    welcome="How can I help you today?"
    onSend={async (message, {messages, signal}) => {
      const response = await fetch('/api/jarvis', {
        method: 'POST', signal,
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({message, messages}),
      });
      if (!response.ok) throw new Error('Jarvis is unavailable. Please try again.');
      const result = await response.json();
      return result.reply;
    }}
  />;
}
```

Keep service credentials on the server. Replies are rendered as plain text, never HTML. `onSend` receives an abort signal cancelled when chat unmounts. Without `onSend`, chat explicitly reports that the assistant service is not connected and saves messages locally; it never fabricates an AI response.

## Integration

- `onOpenPage` and `onPopOut` optionally show “Open Assistant Hub” and separate-window buttons. Chat headers show “Synergy Network's Helpful Assistant” beneath Jarvis. The Portal adapters implement these through Tauri.
- `storageKey` isolates character position, popup size, and default message keys. `messagePrefix` preserves an existing conversation store. History is local to the browser origin; nothing is sent until `onSend` is called. At most 100 messages are displayed. Clearing site data removes preferences and history.
- `mobileBottomOffset` reserves room above a mobile navigation dock. Default: 24 px; Portal uses 104 px below 800 px viewport width.
- `hidden` removes the widget on the full Jarvis page. `JarvisChat` and `JarvisCharacter` are exported separately.
- Jarvis stays anchored bottom-right. Pointer dragging and arrow keys can reposition him. Chat reserves a lane for Jarvis on its right, including narrow windows. Closing or minimizing returns him to the bottom-right corner. Chat can be resized, moved, dismissed with Escape, opened as a page or popped out through optional callbacks.
- Moving Jarvis while chat is open keeps the popup beside him. Dragging or resizing chat does not restart or change his expressions, and hovering or clicking him with chat open does not interrupt his animation or close chat. Dedicated-window hosts can use `JarvisConversation` to reserve a character lane beside the messages. The package uses client components and does not require the Portal wallet or Tauri runtime.
- The default character is a full robot: a square canvas head with a shaded torso, articulated arms and hands, legs and feet. Its body follows all nine expression states, including waving, thinking, working, speaking gestures and seated sleep. A locally adapted MIT renderer constrains the head to its neck; body motion uses one animation loop per visible avatar, eases between poses, and respects reduced motion and pause. `characterStyle="head"` selects the original head-only presentation. Set `robotTheme={{color: '#0066ff', trimColor: '#00ff66', screenColor: '#00ff66'}}` for the blue Portal, or swap blue and green for the developer Portal. The same option works on `JarvisWidget`, `JarvisConversation`, `JarvisAssistantHub`, and `JarvisCharacter`.
- Jarvis starts sleeping, wakes for chat activity, listens during typing, searches for lookup questions, works on action requests, thinks on other questions, speaks with a reply, smiles afterwards, and shows the error expression on failure. The idle animation fills the gaps, then sleeps after 60 seconds without interaction. Pending requests stay awake. All nine upstream states have contextual triggers. Animation runs independently of mouse movement; chat dragging/resizing never restarts reactions.
- There is no pause button or hover background. Upstream respects reduced motion and pauses drawing while the document is hidden.

## Original Character And Licensing

The original Jarvis PNG sprite sheets, frame map, animation scheduler, and renderer are preserved. They are inactive by default. Set `characterStyle="sprite"` on the widget, conversation, hub, or character to switch back. `JarvisSpriteCharacter` is also exported directly. Original PNGs remain unchanged; the legacy renderer still removes border-connected black and neighboring fragments without erasing the visor.

The package and supplied sprite artwork remain private (`UNLICENSED`). The robot-head dependency and adapted renderer are MIT licensed by Fayaz Ahmed; its license is retained in `src/robot-heads.LICENSE.txt` and the installed dependency. Source: https://github.com/fayazara/robot-heads. No registry publication is performed. Run `npm pack --dry-run` to inspect the distributable and `npm test` for placement, expression transitions, and preserved sprite behavior.

## Preview Replies

Both Portal apps use `createPresetResponder()` for varied, topic-aware preset replies, labeled “Preset replies”. These are a preview, not AI-generated answers or live account data. To enable the same mode on a website, pass `onSend={createPresetResponder()}` and `serviceLabel="Preset replies"`. Create the responder once outside the component so its reply rotation persists. Replace `onSend` with your server callback when a live service is ready.

## Conversations And History

The × button ends the current conversation. Opening Jarvis again starts a new chat; minimize preserves the current chat. Messages remain in local device history. `JarvisAssistantHub` adds a history list with readable past conversations and a New chat action. Old Portal messages are kept together as a legacy conversation. The history view currently covers the latest 100 stored messages; clearing site data removes local history.

## Full-body preview

Run `pnpm dev` and open http://127.0.0.1:1430 to inspect all nine animated poses in either Portal palette and try the interactive chat. `pnpm build:preview` builds the demo. The default `characterStyle="robot"` is full-body; `"head"` and `"sprite"` preserve the earlier presentations.

The chest panel contains the rotating Synergy Network logo (with a still frame for pause/reduced motion). The smaller head stays attached to its neck. Arms render in front of the torso, and the happy pose waves an open hand. Sleep lowers the body, folds the legs across each other, rests the hands at the sides, and then closes the eyes.

The active full-body renderer combines a shaded 2D SVG body with the 3D canvas head. A separate foreground SVG layer keeps the articulated arms and hands above both the torso and head during every gesture. The experimental mesh body renderer remains in the source but is inactive.

## Extra expressions

`hearts` shows pink heart eyes and a pink glow, `money` shows green dollar-sign eyes, and `cool` writes COOL on the face. These work with full-body and head-only characters. Chat shows the matching reaction after replying to thanks/love, money/reward topics, or positive words such as “cool” and “awesome”. Original sprites use their greeting reaction as a fallback.
