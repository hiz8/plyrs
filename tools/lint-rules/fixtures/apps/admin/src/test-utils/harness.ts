// test-utils は層のルールの対象外。パッケージのルールだけかかる
import { a } from "../router"; // OK
import { b } from "@plyrs/db"; // NG
import { c } from "~/lib/x"; // OK
export const v = [a, b, c];
