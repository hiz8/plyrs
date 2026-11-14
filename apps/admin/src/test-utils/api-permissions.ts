// api の権限表(apps/api/src/auth/permissions.ts)を、契約のテスト向けに再 export する。
// admin の権限表(shared/lib/permissions.ts)は api の写しなので、shared/lib/permissions.test.ts が
// この 2 つを突き合わせる。shared のテストは区画の外へ相対 import で出られないため、
// 層のルールの対象外である test-utils を通す。テスト以外からは import しない
export * from "../../../api/src/auth/permissions";
