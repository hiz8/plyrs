import { defineConfig, type DummyRuleMap, type OxlintOverride } from "oxlint";

// 依存ルールの生成元(docs/adr/0001-admin-directory-structure.md)。
// oxlint は、同じファイルに当たる override のうち後のものでルールの設定全体を置き換える(マージしない)。
// そのため、1 つのファイルに当たる no-restricted-imports の設定は、ここで組み立てて 1 つにまとめる。

type Pattern = { group: string[]; message: string } | { regex: string; message: string };
type PathRule = { name: string; message: string };
type Override = OxlintOverride;

const ADMIN = "apps/admin/src";

// --- 管理画面の feature(手順 4 で追加する) ---

// feature の一覧。feature を追加・削除するときはここを変える
const FEATURES: string[] = [];
// 依存元 → 依存してよい他 feature(index.ts 経由のみ)
const ALLOW_CROSS: Record<string, string[]> = {};
// feature・shared の区画の中のディレクトリの最大の深さ。これより深いファイルは、相対 import の検査から漏れる
const MAX_DEPTH = 4;

// --- 共通のパターン ---

// テストのファイル(test-utils を import してよいもの)
const TEST_FILE_GLOBS = ["**/*.test.{ts,tsx}", "**/-tests/**"];

const TEST_UTILS_BAN: Pattern = {
  group: ["~/test-utils/**", "**/test-utils/**"],
  message: "test-utils はテストからだけ import する",
};

// app 層(src 直下のフレームワークのエントリと app/)
const APP_LAYER_BANS: Pattern[] = [
  {
    group: ["~/app/**", "~/router", "~/start", "~/server", "~/routeTree.gen"],
    message: "app 層(エントリと app/)へは依存できない",
  },
  {
    regex: "^(\\.\\./)+(app/.*|router|start|server|routeTree\\.gen)$",
    message: "app 層(エントリと app/)へは依存できない",
  },
];

// 相対 import で、区画のルートより上へ出るもの。depth は区画のルートからのファイルの深さ
function relativeEscapeBan(depth: number, message: string): Pattern {
  return { group: [`${"../".repeat(depth)}**`], message };
}

// --- パッケージ間の依存(Nx 式の分類) ---

const pkg = (name: string) => [`@plyrs/${name}`, `@plyrs/${name}/**`];
const packageBan = (names: string[], reason: string): Pattern => ({
  group: names.flatMap(pkg),
  message: `パッケージの依存ルール: ${reason}`,
});

// 依存元のディレクトリ → 依存できないパッケージ
const PACKAGE_BANS: Record<string, Pattern[]> = {
  // util は util にだけ依存してよい
  "packages/metamodel": [
    packageBan(["sync-client", "db", "ui", "admin", "api", "e2e"], "util は util にだけ依存する"),
  ],
  "packages/sync-protocol": [
    packageBan(["sync-client", "db", "ui", "admin", "api", "e2e"], "util は util にだけ依存する"),
  ],
  "packages/richtext": [
    packageBan(["sync-client", "db", "ui", "admin", "api", "e2e"], "util は util にだけ依存する"),
  ],
  // data-access は util と同じ scope の data-access に依存してよい
  "packages/sync-client": [
    packageBan(
      ["db", "ui", "admin", "api", "e2e"],
      "scope shared の data-access は util にだけ依存する",
    ),
  ],
  "packages/db": [
    packageBan(["sync-client", "ui", "admin", "api", "e2e"], "scope api の data-access"),
  ],
  // ui は util にだけ依存してよい(data-access には依存しない)
  "packages/ui": [
    packageBan(["sync-client", "db", "admin", "api", "e2e"], "ui は util にだけ依存する"),
  ],
  // app は、自分の scope と scope shared のパッケージに依存してよい。app 同士は依存しない
  "apps/admin": [
    packageBan(["db", "api", "e2e"], "scope web の app は scope api のパッケージを使わない"),
  ],
  "apps/api": [
    packageBan(["ui", "admin", "e2e"], "scope api の app は scope web のパッケージを使わない"),
  ],
};

const ADMIN_PACKAGE_BANS = PACKAGE_BANS["apps/admin"] ?? [];

function restricted(patterns: Pattern[], paths: PathRule[] = []): DummyRuleMap {
  return { "no-restricted-imports": ["error", { paths, patterns }] };
}

// 管理画面のファイルに当たる override を、テスト以外とテストの 2 つに分けて作る。
// テスト以外には test-utils の禁止を足す。files は "…/**" か "…/*.{ts,tsx}" で終わるグロブ
function adminOverrides(files: string[], patterns: Pattern[], paths: PathRule[] = []): Override[] {
  const testFiles = files.flatMap((glob) =>
    glob.endsWith("/**")
      ? [`${glob}/*.test.{ts,tsx}`, `${glob}/-tests/**`]
      : [glob.replace(/\*\.\{ts,tsx\}$/, "*.test.{ts,tsx}")],
  );
  return [
    {
      files,
      excludeFiles: TEST_FILE_GLOBS,
      rules: restricted([...patterns, ...ADMIN_PACKAGE_BANS, TEST_UTILS_BAN], paths),
    },
    { files: testFiles, rules: restricted([...patterns, ...ADMIN_PACKAGE_BANS], paths) },
  ];
}

// 区画のルート(feature や shared の区画)から、ファイルの深さごとの override を作る。
// 相対 import で区画の外へ出たかどうかは、ファイルの深さが分からないと判定できないため
function byDepth(
  root: string,
  make: (depth: number) => Pattern[],
  paths: PathRule[] = [],
): Override[] {
  return Array.from({ length: MAX_DEPTH }, (_, i) => i + 1).flatMap((depth) =>
    adminOverrides([`${root}/${"*/".repeat(depth - 1)}*.{ts,tsx}`], make(depth), paths),
  );
}

// --- 管理画面の層ごとの override ---

// 1. 管理画面全体: パッケージの依存ルールと test-utils の禁止(以降の override がない場所に効かせる)
const adminBase = adminOverrides([`${ADMIN}/**`], []).map((o) =>
  o.excludeFiles === undefined
    ? o
    : { ...o, excludeFiles: [...o.excludeFiles, `${ADMIN}/test-utils/**`] },
);

// 2. routes: 自分のサブツリーと祖先の - 付きディレクトリ、features(index.ts のみ)、shared に依存してよい
const routesOverrides = adminOverrides(
  [`${ADMIN}/routes/**`],
  [
    {
      // 相対 import だけに当てる。group の否定(!~/**)は同じルールの ~/ のパターンまで打ち消すので使わない
      regex: "^(\\.\\./)+(.*/)?(features|shared|app)(/|$)",
      message: "routes から features・shared・app へは ~/ で import する",
    },
    {
      regex: "/[^./][^/]*/-[^/]+",
      message: "別のサブツリーの - 付きディレクトリは import しない(祖先のものだけ使える)",
    },
    { group: ["~/routes/**"], message: "routes の中は相対 import で書く" },
    { group: ["~/features/*/**"], message: "feature は公開 API(index.ts)経由で import する" },
    ...APP_LAYER_BANS,
  ],
);

// 3. shared: shared の中だけに依存してよい。区画(shared/<区画>/)の外へは ~/shared/ で出る
const sharedOverrides = byDepth(`${ADMIN}/shared/*`, (depth) => [
  { group: ["~/**", "!~/shared/**"], message: "shared は shared にだけ依存する" },
  {
    regex: "^(\\.\\./)+(.*/)?(features|routes|app)(/|$)",
    message: "shared は shared にだけ依存する",
  },
  ...APP_LAYER_BANS,
  relativeEscapeBan(depth, "shared の区画の外へ出る import は ~/ で書く"),
]);

// 4. features: 自 feature の内部、許可リストにある他 feature(index.ts のみ)、shared に依存してよい
const featureOverrides = FEATURES.flatMap((f) =>
  byDepth(
    `${ADMIN}/features/${f}`,
    (depth) => [
      {
        group: ["~/features/*/**", `!~/features/${f}/**`],
        message: "他 feature は公開 API(index.ts)経由で import する",
      },
      { group: ["~/routes/**"], message: "features から routes へは依存できない" },
      ...APP_LAYER_BANS,
      relativeEscapeBan(depth, "feature の外へ出る import は ~/ で書く"),
    ],
    FEATURES.filter((o) => o !== f && !(ALLOW_CROSS[f] ?? []).includes(o)).map((o) => ({
      name: `~/features/${o}`,
      message: `features/${f} から features/${o} への依存は許可されていない`,
    })),
  ),
);

// --- 管理画面以外のパッケージ ---

const packageOverrides: Override[] = Object.entries(PACKAGE_BANS)
  .filter(([dir]) => dir !== "apps/admin")
  .map(([dir, patterns]) => ({ files: [`${dir}/**`], rules: restricted(patterns) }));

export default defineConfig({
  categories: {
    correctness: "error",
    suspicious: "warn",
  },
  ignorePatterns: [
    "dist",
    "node_modules",
    ".wrangler",
    "coverage",
    ".claude",
    ".superpowers",
    "**/routeTree.gen.ts",
    "**/worker-configuration.d.ts",
  ],
  // 順序に意味がある: 後の override が、同じファイルの no-restricted-imports の設定を置き換える
  overrides: [
    ...packageOverrides,
    ...adminBase,
    ...routesOverrides,
    ...sharedOverrides,
    ...featureOverrides,
  ],
});
