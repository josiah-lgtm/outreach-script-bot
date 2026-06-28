// The config document is a large, dynamically-shaped JSON object (the legacy app was
// untyped JS). We keep these types deliberately loose so the ported logic and the UI
// can index freely, exactly as before — strictness here would fight the data model.

export type Config = {
  version?: number;
  _rev?: number;
  _dirty?: boolean;
  settings?: any;
  frameworks?: any[];
  niches?: any[];
  clients?: any[];
  prospects?: any[];
  winningScripts?: any[];
  followupFrameworks?: any[];
  toolsKB?: any[];
  sellerProfile?: any;
  [k: string]: any;
};

export type Client = { id: string; name: string; [k: string]: any };
export type Niche = { id: string; name: string; [k: string]: any };
export type Framework = { id: string; name: string; category?: string; template?: string; rules?: string; [k: string]: any };
export type ConfigSource = "server" | "local" | "defaults";
