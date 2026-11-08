// shared の直下のファイル
import { a } from "~/features/fixa"; // NG
import { b } from "~/shared/ui/button"; // OK
import { c } from "./ui/button"; // OK
import { d } from "../lib/x"; // NG
export const v = [a, b, c, d];
