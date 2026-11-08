import { a } from "~/test-utils/x"; // OK
import { b } from "@plyrs/db"; // NG
import { c } from "~/features/fixa/internal"; // NG
export const v = [a, b, c];
