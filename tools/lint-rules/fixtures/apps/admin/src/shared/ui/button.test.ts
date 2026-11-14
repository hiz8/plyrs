import { a } from "~/test-utils/x"; // OK
import { b } from "~/features/fixa"; // NG
import { c } from "@plyrs/db"; // NG
import { d } from "./button"; // OK
import { r } from "~/router"; // NG(routes 以外のテストは app 層を使えない)
export const v = [a, b, c, d];
