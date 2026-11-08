import { createConfig } from "../../../oxlint.config.ts";

// fixture 用の設定。グロブはこのファイルの場所からの相対なので、fixtures/ の下に apps/ や packages/ を
// 実際と同じ形で置く。feature のルールも確かめるため、feature を 2 つ登録する(fixa → fixb だけ許可)
export default createConfig({ features: ["fixa", "fixb"], allowCross: { fixa: ["fixb"] } });
