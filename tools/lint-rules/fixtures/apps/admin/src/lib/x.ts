// 旧構成(手順 5 までの lib/)
import { a } from "../test-utils/x"; // NG
import { b } from "@plyrs/api/src/index"; // NG
import { c } from "../components/x"; // OK
import { d } from "@plyrs/sync-client"; // OK
export const v = [a, b, c, d];
