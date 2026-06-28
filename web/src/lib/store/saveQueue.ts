// The single global debounced save queue — the CAS-correctness linchpin. One 600ms
// debounce timer and one in-flight guard for the WHOLE app, so multiple components/effects
// mutating config never fire overlapping save_config calls at the same baseRev.
//
// The conflict-merge + retry recursion lives inside the task (configStore._flush), mirroring
// the legacy serverSaveWithRetry; this primitive only guarantees debounce + single-flight.

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let pending = false;
let task: (() => Promise<void>) | null = null;

export function scheduleSave(run: () => Promise<void>, delay = 600): void {
  task = run;
  if (timer) clearTimeout(timer);
  timer = setTimeout(fire, delay);
}

async function fire(): Promise<void> {
  timer = null;
  if (running) { pending = true; return; } // a save chain is active — coalesce into one trailing run
  const run = task;
  task = null;
  if (!run) return;
  running = true;
  try {
    await run();
  } finally {
    running = false;
    if (pending) { pending = false; scheduleSave(task ?? run, 600); }
  }
}
