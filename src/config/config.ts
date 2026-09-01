// src/config/config.ts
import fs from "node:fs";
import path from "node:path";
import { getConfigDir } from "./paths.js";

export interface SlackclawConfig {
  workspaces: { teamId: string; name: string; isDefault: boolean }[];
}

const DEFAULT_CONFIG: SlackclawConfig = { workspaces: [] };

export function loadConfig(): SlackclawConfig {
  const file = path.join(getConfigDir(), "config.json");
  if (!fs.existsSync(file)) return structuredClone(DEFAULT_CONFIG);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function saveConfig(cfg: SlackclawConfig): void {
  const dir = getConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(cfg, null, 2));
}
