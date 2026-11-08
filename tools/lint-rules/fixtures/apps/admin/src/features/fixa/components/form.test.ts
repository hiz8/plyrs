import { a } from "~/test-utils/x"; // OK
import { b } from "./form"; // OK
import { c } from "~/routes/x"; // NG
export const v = [a, b, c];
