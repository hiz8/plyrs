import { PROTOCOL_VERSION, type ServerMessage } from "@plyrs/sync-protocol";
import {
  currentServerSeq,
  loadAllContentTypes,
  loadSyncRecordsSince,
  SYNC_PAGE_SIZE,
} from "./records";

// G1: content_types は seq を消費しない別チャネル。welcome で全量を配る。
// G2: records は seq チェックポイントの差分（トゥームストーン込み）をページで配る。
export function handleHello(sql: SqlStorage, checkpoint: number): ServerMessage[] {
  const serverSeq = currentServerSeq(sql);
  const messages: ServerMessage[] = [
    {
      type: "welcome",
      protocolVersion: PROTOCOL_VERSION,
      contentTypes: loadAllContentTypes(sql),
      serverSeq,
    },
  ];

  let cursor = checkpoint;
  for (;;) {
    const records = loadSyncRecordsSince(sql, cursor, SYNC_PAGE_SIZE);
    const complete = records.length < SYNC_PAGE_SIZE;
    messages.push({ type: "sync", records, serverSeq, complete });
    if (complete) {
      return messages;
    }
    const last = records[records.length - 1];
    if (last === undefined) {
      return messages;
    }
    cursor = last.seq;
  }
}
