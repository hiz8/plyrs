// MAX_DEPTH より深いファイルにも層のルールがかかる
import { a } from "~/routes/x"; // NG
import { b } from "~/features/fixa/internal"; // NG
import { c } from "~/shared/styles/x"; // OK
export const v = [a, b, c];
