import { locateSlackCacheDir } from "../sources/cache/locate.js";
import { getDbPath } from "../config/paths.js";
import fs from "node:fs";

export interface DoctorReport {
  cacheDirFound: boolean;
  cacheDirPath: string | null;
  dbExists: boolean;
  dbPath: string;
}

export function runDoctor(): DoctorReport {
  const cacheDir = locateSlackCacheDir();
  const dbPath = getDbPath();
  return {
    cacheDirFound: cacheDir !== null,
    cacheDirPath: cacheDir,
    dbExists: fs.existsSync(dbPath),
    dbPath,
  };
}

export function printDoctorReport(r: DoctorReport, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(r, null, 2));
    return;
  }
  console.log(`cache dir found: ${r.cacheDirFound ? "yes -> " + r.cacheDirPath : "no"}`);
  console.log(
    `database: ${r.dbExists ? "exists at " + r.dbPath : "not yet created (" + r.dbPath + ")"}`,
  );
}
