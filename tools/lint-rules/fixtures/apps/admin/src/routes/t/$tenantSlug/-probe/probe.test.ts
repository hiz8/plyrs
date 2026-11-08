import { a } from "~/test-utils/x"; // OK
import { b } from "@plyrs/db"; // NG
import { c } from "~/features/fixa/internal"; // NG
import { r } from "~/router"; // OK(routes のテストはルーターを組み立ててよい)
export const v = [a, b, c];
