// Shape of a saved script on the board (a `scriptReservoir` item). The persisted config
// is dynamically shaped, so this names the fields the board UI reads and leaves the rest
// open via the index signature — without resorting to `any` (disallowed in components).

import type { ScriptVersion } from "@/components/ScriptEditModal";

export interface BoardScript {
  id: string;
  name?: string;
  framework?: string;
  angle?: string;
  label?: string;
  script?: string;
  status?: string;
  note?: string;
  savedAt?: string;
  versions?: ScriptVersion[];
  [k: string]: unknown;
}
