const replies = {
  greeting: ["Hi! I’m Jarvis, Synergy Network’s helpful assistant. What would you like to explore today?", "Hello! Ready to explore Portal together? Ask me about the wallet, dApps, or your workspace.", "Hey there! What can I help you find in the Synergy ecosystem?"],
  wallet: ["Use Connect Wallet at the top of Portal to pair your Synergy Wallet. Once connected, the same account is shared across the dApps in this Portal window.", "Your Synergy Wallet is your connection to Portal’s dApps. Connect it once from the top bar, then explore the ecosystem with that account."],
  apps: ["Open the dApp Hub from the bottom dock to browse the ecosystem. You can favorite apps and customize your dock for quick access.", "The dock gets you to your apps quickly. The dApp Hub is where you can browse more of the Synergy ecosystem and choose your favorites."],
  workspace: ["Choose Customize on the Dashboard to arrange your modules, resize them, and make the workspace your own. Save your layout when you’re happy with it.", "Your Dashboard brings your workspace together. Use Customize to move modules around or add the ones you want to keep close."],
  jarvis: ["I’m Jarvis, your Synergy companion. You can move this chat, resize it, minimize it, open it in a separate window, or visit the Assistant Hub.", "I’m here to help you find your way around Portal. These are preset replies for this preview; a live assistant service will be connected later."],
  security: ["Keep your recovery phrase and private keys private. Jarvis will never ask you to share them. Review and approve transactions in your wallet yourself.", "Always review what you’re approving in your wallet. Connecting an account doesn’t authorize a payment, and you should never share your recovery phrase here."],
  thanks: ["You’re welcome! I’m here whenever you need a hand.", "Happy to help. What would you like to explore next?"],
  generic: ["Let’s explore that together. I can help you find your way around the Dashboard, dApp Hub, wallet connection, or Assistant Hub.", "What would you like to do next in Portal? You can explore dApps, connect your wallet, or customize your workspace.", "I’m here to help you get oriented. Tell me whether you’re looking for an app, your wallet, or your Dashboard.", "You can keep this chat beside your workspace while you explore. What part of Portal would you like a hand with?", "For this preview, I have a few helpful preset tips. Try asking about the wallet, dApp Hub, customizing the Dashboard, or keeping your account safe."],
};
export function createPresetResponder() {
  const counts = new Map();
  return async (message, {signal} = {}) => {
    if (signal?.aborted) throw new DOMException('Request cancelled', 'AbortError');
    // Give the preview a brief, cancellable thinking/searching/working beat.
    await new Promise((resolve, reject) => {
      const cancel = () => {clearTimeout(timer); reject(new DOMException('Request cancelled', 'AbortError'));};
      const timer = setTimeout(() => {signal?.removeEventListener('abort', cancel); resolve();}, 500);
      signal?.addEventListener('abort', cancel, {once: true});
    });
    const text = message.toLowerCase();
    const topic = /seed|private key|recovery|secur|safe/.test(text) ? 'security'
      : /wallet|connect|pair/.test(text) ? 'wallet'
      : /dashboard|workspace|customiz|module/.test(text) ? 'workspace'
      : /dapp|apps?\b|atlas|forge|keystone|horizon|spark|dock/.test(text) ? 'apps'
      : /jarvis|assistant|who are|what can/.test(text) ? 'jarvis'
      : /thank/.test(text) ? 'thanks'
      : /^(hi|hello|hey|good morning|good evening)\b/.test(text) ? 'greeting' : 'generic';
    const index = counts.get(topic) || 0;
    counts.set(topic, index + 1);
    return replies[topic][index % replies[topic].length];
  };
}
