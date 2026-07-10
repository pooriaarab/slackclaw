import fs from "node:fs";
import path from "node:path";
import v8 from "node:v8";
import { uncompress } from "snappyjs";

// Blob header bytes Chromium/Slack Desktop write before an optionally
// snappy-compressed payload. When present, bytes from index 3 onward are a
// raw snappy stream; when absent the blob is already the V8-serialized state.
const SNAPPY_HEADER = Buffer.from([0xff, 0x11, 0x02]);
// V8 ValueSerializer format marker. The redux-persist blob has some bytes of
// its own envelope before this; slicing from here on gives a valid
// v8.deserialize() input.
const V8_HEADER = Buffer.from([0xff, 0x0f]);

export interface DecodedReduxState {
  blobPath: string;
  value: any;
}

export interface DumpResult {
  states: DecodedReduxState[];
  skipped: number;
}

function listBlobFiles(blobRoot: string): string[] {
  const files: string[] = [];
  const stack = [blobRoot];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else files.push(full);
    }
  }
  return files.sort();
}

function decodeBlob(blobPath: string): any | null {
  const raw = fs.readFileSync(blobPath);
  let decoded: Buffer = raw;
  if (raw.subarray(0, 3).equals(SNAPPY_HEADER)) {
    decoded = Buffer.from(uncompress(raw.subarray(3)));
  }

  const offset = decoded.indexOf(V8_HEADER);
  if (offset < 0) return null;

  return v8.deserialize(decoded.subarray(offset));
}

/** Walks Slack Desktop's IndexedDB blob directory, snappy-decompresses and
 * V8-deserializes each file, and returns whichever decode as a plausible
 * redux state (has at least one of channels/members/messages). A blob that
 * fails to decode (corrupt, unsupported envelope, unrelated blob type) is
 * skipped and counted, never thrown -- one bad file must not abort the run. */
export function dumpCache(blobDir: string): DumpResult {
  const states: DecodedReduxState[] = [];
  let skipped = 0;

  for (const blobPath of listBlobFiles(blobDir)) {
    try {
      const value = decodeBlob(blobPath);
      if (value && typeof value === "object" && (value.channels || value.members || value.messages)) {
        states.push({ blobPath, value });
      } else {
        skipped++;
      }
    } catch {
      skipped++;
    }
  }

  return { states, skipped };
}
