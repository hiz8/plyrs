import { a } from "~/test-utils/x"; // OK
import { b } from "../../router"; // NG
import { s } from "~/start"; // NG(テストで許すのは ~/router だけ)
export const v = [a, b];
