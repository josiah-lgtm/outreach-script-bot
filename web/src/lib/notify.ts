// Tiny toast pub/sub so non-React modules (stores, sync layer) can surface a message
// without importing React. The <ToastProvider> subscribes via onNotify; everything else
// calls notify(). Replaces the legacy single #notif element + showNotif().

type Listener = (msg: string, error: boolean) => void;
const listeners = new Set<Listener>();

export function onNotify(l: Listener): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function notify(msg: string, error = false): void {
  listeners.forEach((l) => { try { l(msg, error); } catch { /* ignore */ } });
}
