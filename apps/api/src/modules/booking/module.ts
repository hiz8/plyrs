import type { ModuleDefinition } from "../registry";
import { BOOKING_MANIFEST } from "./manifest";

// フック・イベント・alarm・公開エンドポイントは Task 10 / 12 で実装する。
export const bookingModule: ModuleDefinition = {
  manifest: BOOKING_MANIFEST,
};
