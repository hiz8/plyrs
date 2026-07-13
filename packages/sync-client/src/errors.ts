import type { FieldConflict } from "@plyrs/sync-protocol";

// ack {ok:false} をハンドラから throw して tanstack-db の楽観的オーバーレイを
// ロールバックさせるためのエラー。code / conflicts を UI に運ぶ。
export class SyncRejectedError extends Error {
  readonly code: string;
  readonly conflicts: FieldConflict[];

  constructor(code: string, message: string, conflicts: FieldConflict[] = []) {
    super(message);
    this.name = "SyncRejectedError";
    this.code = code;
    this.conflicts = conflicts;
  }
}
