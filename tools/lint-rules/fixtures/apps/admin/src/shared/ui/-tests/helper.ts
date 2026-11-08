// -tests/ の中の補助ファイル(テスト扱い)にも層のルールがかかる
import { a } from "~/test-utils/x"; // OK
import { b } from "~/features/x"; // NG
import { c } from "~/lib/x"; // NG
export const v = [a, b, c];
