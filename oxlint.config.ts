import { defineConfig, type DummyRuleMap, type OxlintConfig, type OxlintOverride } from "oxlint";

// 依存ルールの生成元(docs/adr/0001-admin-directory-structure.md)。
// oxlint は、同じファイルに当たる override のうち後のものでルールの設定全体を置き換える(マージしない)。
// そのため、1 つのファイルに当たる no-restricted-imports の設定は、ここで組み立てて 1 つにまとめる。
// ルールが意図どおり検出するかは tools/lint-rules の fixture で確かめている(pnpm test で実行される)。

type Pattern = { group: string[]; message: string } | { regex: string; message: string };
type PathRule = { name: string; message: string };

// 管理画面の feature の設定。手順 4 で feature を追加するときは、下の FEATURES と ALLOW_CROSS を変える
export interface FeatureOptions {
  // feature の一覧
  features: string[];
  // 依存元 → 依存してよい他 feature(index.ts 経由のみ)
  allowCross: Record<string, string[]>;
}

const FEATURES: FeatureOptions = {
  features: ["media", "content-types", "records"],
  allowCross: { records: ["media"] },
};

const ADMIN = "apps/admin/src";

// feature・shared の中で、相対 import が区画の外へ出たかを検査するディレクトリの深さの上限。
// これより深いファイルにも層のルールはかかるが、相対 import で区画の外へ出たことは検出できない
const MAX_DEPTH = 6;

// --- 共通のパターン ---

// テストのファイル(test-utils を import してよいもの)。-tests/ の中はテスト用の補助ファイルも含めてテスト扱い
const TEST_FILE_GLOBS = ["**/*.test.{ts,tsx}", "**/-tests/**"];

const TEST_UTILS_BAN: Pattern = {
  group: ["~/test-utils/**", "**/test-utils/**"],
  message: "test-utils はテストからだけ import する",
};

// app 層(src 直下のフレームワークのエントリと app/)。allowRouter は、ルーターの組み立て(router.tsx)だけを許すとき
function appLayerBans({ allowRouter = false }: { allowRouter?: boolean } = {}): Pattern[] {
  const entries = ["router", "start", "server", "routeTree.gen"].filter(
    (e) => !(allowRouter && e === "router"),
  );
  return [
    {
      group: ["~/app/**", ...entries.map((e) => `~/${e}`)],
      message: "app 層(エントリと app/)へは依存できない",
    },
    {
      regex: "^(\\.\\./)+(app/.*|router|start|server|routeTree\\.gen)$",
      message: "app 層(エントリと app/)へは依存できない(テストで許すときも ~/router で書く)",
    },
  ];
}
const APP_LAYER_BANS = appLayerBans();

// 相対 import で、区画のルートより上へ出るもの。up は区画のルートまでに遡る段数
function relativeEscapeBan(up: number, message: string): Pattern {
  return { group: [`${"../".repeat(up)}**`], message };
}

// --- パッケージ間の依存(Nx 式の分類) ---

const pkg = (name: string) => [`@plyrs/${name}`, `@plyrs/${name}/**`];
const packageBan = (names: string[], reason: string): Pattern => ({
  group: names.flatMap(pkg),
  message: `パッケージの依存ルール: ${reason}`,
});

const ALL_PACKAGES = ["metamodel", "sync-protocol", "richtext", "sync-client", "db", "ui"];
const ALL_APPS = ["admin", "api", "e2e"];

// 依存元のディレクトリ → 依存できないパッケージ
const PACKAGE_BANS: Record<string, Pattern[]> = {
  // util は util にだけ依存してよい
  "packages/metamodel": [
    packageBan(["sync-client", "db", "ui", ...ALL_APPS], "util は util にだけ依存する"),
  ],
  "packages/sync-protocol": [
    packageBan(["sync-client", "db", "ui", ...ALL_APPS], "util は util にだけ依存する"),
  ],
  "packages/richtext": [
    packageBan(["sync-client", "db", "ui", ...ALL_APPS], "util は util にだけ依存する"),
  ],
  // data-access は util と同じ scope の data-access に依存してよい
  "packages/sync-client": [
    packageBan(["db", "ui", ...ALL_APPS], "scope shared の data-access は util にだけ依存する"),
  ],
  "packages/db": [packageBan(["sync-client", "ui", ...ALL_APPS], "scope api の data-access")],
  // ui は util にだけ依存してよい(data-access には依存しない)
  "packages/ui": [packageBan(["sync-client", "db", ...ALL_APPS], "ui は util にだけ依存する")],
  // app は、自分の scope と scope shared のパッケージに依存してよい。app 同士は依存しない
  "apps/admin": [
    packageBan(["db", "api", "e2e"], "scope web の app は scope api のパッケージを使わない"),
  ],
  "apps/api": [
    packageBan(["ui", "admin", "e2e"], "scope api の app は scope web のパッケージを使わない"),
  ],
  // e2e は画面を外から操作するだけで、ワークスペースのパッケージには依存しない
  "apps/e2e": [
    packageBan([...ALL_PACKAGES, "admin", "api"], "e2e はワークスペースのパッケージに依存しない"),
  ],
};

const ADMIN_PACKAGE_BANS = PACKAGE_BANS["apps/admin"] ?? [];

function restricted(patterns: Pattern[], paths: PathRule[] = []): DummyRuleMap {
  return { "no-restricted-imports": ["error", { paths, patterns }] };
}

// --- 管理画面の区画ごとの override ---

// 区画のパターン。test はテストのファイル向けか、up は相対 import の検査で区画のルートまでに遡る段数
// (undefined のときは相対 import の検査をしない)
type Make = (ctx: { test: boolean; up?: number }) => Pattern[];

// 区画(root 以下)の override を作る。どのファイルも必ずどれかに当たるように、次の順で並べる。
//   1. 区画全体(root/**)のテスト以外とテスト: 深さに依存しない層のルール
//   2. depth が指定されたとき、深さ 1〜MAX_DEPTH のテスト以外とテスト: 1 に相対 import の検査を足したもの
// 後の override が前の設定を置き換えるので、深さ MAX_DEPTH までのファイルには 2、それより深いファイルには 1 がかかる
function regionOverrides(
  root: string,
  make: Make,
  options: { upForDepth?: (depth: number) => number; paths?: PathRule[] } = {},
): OxlintOverride[] {
  const paths = options.paths ?? [];
  const pair = (files: string[], testFiles: string[], up: number | undefined): OxlintOverride[] => [
    {
      files,
      excludeFiles: TEST_FILE_GLOBS,
      rules: restricted(
        [...make({ test: false, up }), ...ADMIN_PACKAGE_BANS, TEST_UTILS_BAN],
        paths,
      ),
    },
    {
      files: testFiles,
      rules: restricted([...make({ test: true, up }), ...ADMIN_PACKAGE_BANS], paths),
    },
  ];
  const whole = pair(
    [`${root}/**`],
    [`${root}/**/*.test.{ts,tsx}`, `${root}/**/-tests/**`],
    undefined,
  );
  const upForDepth = options.upForDepth;
  if (upForDepth === undefined) return whole;
  const byDepth = Array.from({ length: MAX_DEPTH }, (_, i) => i + 1).flatMap((depth) => {
    const dirs = "*/".repeat(depth - 1);
    // 深さ depth のテスト: *.test.* と、途中のどこかのディレクトリが -tests のもの
    const testFiles = [
      `${root}/${dirs}*.test.{ts,tsx}`,
      ...Array.from(
        { length: Math.max(depth - 1, 0) },
        (_, p) => `${root}/${"*/".repeat(p)}-tests/${"*/".repeat(depth - 2 - p)}*.{ts,tsx}`,
      ),
    ];
    return pair([`${root}/${dirs}*.{ts,tsx}`], testFiles, upForDepth(depth));
  });
  return [...whole, ...byDepth];
}

export function createConfig({ features, allowCross }: FeatureOptions): OxlintConfig {
  // 1. 管理画面全体: パッケージの依存ルールと test-utils の禁止(以降の区画に入らないファイル向け)
  const adminBase = regionOverrides(ADMIN, () => []);

  // 2. test-utils: 層のルールの対象外。パッケージの依存ルールだけをかける
  const testUtils: OxlintOverride[] = [
    { files: [`${ADMIN}/test-utils/**`], rules: restricted(ADMIN_PACKAGE_BANS) },
  ];

  // 3. routes: 自分のサブツリーと祖先の - 付きディレクトリ、features(index.ts のみ)、shared に依存してよい
  // routes のテストだけは、画面の流れを確かめるためにルーターを組み立ててよい(~/router の import を許す)
  const routes = regionOverrides(`${ADMIN}/routes`, ({ test }) => [
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
    ...appLayerBans({ allowRouter: test }),
  ]);

  // 4. shared: shared の中だけに依存してよい。区画(shared/<区画>/)の外へは ~/shared/ で出る。
  // テストは test-utils も import してよい
  const shared = regionOverrides(
    `${ADMIN}/shared`,
    ({ test, up }) => [
      {
        group: ["~/**", "!~/shared/**", ...(test ? ["!~/test-utils/**"] : [])],
        message: "shared は shared にだけ依存する",
      },
      {
        regex: "^(\\.\\./)+(.*/)?(features|routes|app)(/|$)",
        message: "shared は shared にだけ依存する",
      },
      ...APP_LAYER_BANS,
      ...(up === undefined
        ? []
        : [relativeEscapeBan(up, "shared の区画の外へ出る import は ~/ で書く")]),
    ],
    // shared の直下のファイル(深さ 1)は 1 段上がると shared の外。区画の中(深さ 2 以上)は区画のルートまで depth - 1 段
    { upForDepth: (depth) => (depth === 1 ? 1 : depth - 1) },
  );

  // 5. features: 自 feature の内部、許可リストにある他 feature(index.ts のみ)、shared に依存してよい
  const featureOverrides = features.flatMap((f) =>
    regionOverrides(
      `${ADMIN}/features/${f}`,
      ({ up }) => [
        {
          group: ["~/features/*/**", `!~/features/${f}/**`],
          message: "他 feature は公開 API(index.ts)経由で import する",
        },
        { group: ["~/routes/**"], message: "features から routes へは依存できない" },
        ...APP_LAYER_BANS,
        ...(up === undefined
          ? []
          : [relativeEscapeBan(up, "feature の外へ出る import は ~/ で書く")]),
      ],
      {
        upForDepth: (depth) => depth,
        paths: features
          .filter((o) => o !== f && !(allowCross[f] ?? []).includes(o))
          .map((o) => ({
            name: `~/features/${o}`,
            message: `features/${f} から features/${o} への依存は許可されていない`,
          })),
      },
    ),
  );

  // 管理画面以外のパッケージ
  const packages: OxlintOverride[] = Object.entries(PACKAGE_BANS)
    .filter(([dir]) => dir !== "apps/admin")
    .map(([dir, patterns]) => ({ files: [`${dir}/**`], rules: restricted(patterns) }));

  return defineConfig({
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
      // 依存ルールを確かめる fixture(違反する import をわざと含む)。tools/lint-rules の check.ts が別に検査する
      "tools/lint-rules/fixtures",
    ],
    // 順序に意味がある: 後の override が、同じファイルの no-restricted-imports の設定を置き換える
    overrides: [...packages, ...adminBase, ...testUtils, ...routes, ...shared, ...featureOverrides],
  });
}

export default createConfig(FEATURES);
