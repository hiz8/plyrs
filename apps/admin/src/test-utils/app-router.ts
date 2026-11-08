// テストからルーター(app 層のエントリ)を組み立てるための入口。routes の中に置くテストは
// app 層を直接 import できない(ADR 0001)ので、層のルールの対象外の test-utils から渡す
export { createAppContext, getRouter } from "../router";
