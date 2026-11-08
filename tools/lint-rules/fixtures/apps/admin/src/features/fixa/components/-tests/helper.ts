import { a } from "~/test-utils/x"; // OK
import { b } from "~/routes/x"; // NG
import { c } from "../../../fixb/x"; // NG
import { d } from "../form"; // OK
export const v = [a, b, c, d];
