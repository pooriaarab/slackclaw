// src/config/paths.ts
import path from "node:path";

export interface PathEnv {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  home: string;
}

function currentEnv(): PathEnv {
  return { platform: process.platform, env: process.env, home: process.env.HOME ?? "" };
}

export function getConfigDir(e: PathEnv = currentEnv()): string {
  if (e.platform === "darwin") {
    return path.join(e.home, "Library", "Application Support", "slackclaw");
  }
  const xdgConfig = e.env.XDG_CONFIG_HOME ?? path.join(e.home, ".config");
  return path.join(xdgConfig, "slackclaw");
}

export function getDataDir(e: PathEnv = currentEnv()): string {
  if (e.platform === "darwin") {
    return path.join(e.home, "Library", "Application Support", "slackclaw");
  }
  const xdgData = e.env.XDG_DATA_HOME ?? path.join(e.home, ".local", "share");
  return path.join(xdgData, "slackclaw");
}

export function getDbPath(e: PathEnv = currentEnv()): string {
  return path.join(getDataDir(e), "slackclaw.db");
}