import { a } from "~/features/fixb"; // OK
import { b } from "~/features/fixb/components/x"; // NG
import { c } from "../../fixb"; // NG
import { d } from "../lib/x"; // OK
import { e } from "~/features/fixa/lib/x"; // OK
import { f } from "~/routes/t/x"; // NG
import { g } from "~/shared/styles/x"; // OK
import { h } from "~/router"; // NG
import { i } from "~/test-utils/x"; // NG
import { j } from "../../../shared/x"; // NG
import { k } from "~/features/fixb/index"; // NG
export const v = [a, b, c, d, e, f, g, h, i, j, k];
