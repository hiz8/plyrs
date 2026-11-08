import { a } from "~/test-utils/x"; // OK
import { b } from "~/features/fixa"; // NG
import { c } from "@plyrs/db"; // NG
import { d } from "./button"; // OK
export const v = [a, b, c, d];
