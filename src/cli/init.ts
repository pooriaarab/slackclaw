import { saveConfig, loadConfig } from "../config/config.js";
import { locateSlackCacheDir } from "../sources/cache/locate.js";

export async function runInit(): Promise<void> {
  const cacheDir = locateSlackCacheDir();
  const cfg = loadConfig();
  console.log(cacheDir ? `Found Slack Desktop cache at: ${cacheDir}` : "No local Slack Desktop cache found.");
  saveConfig(cfg);
  console.log("Config written.");
}
