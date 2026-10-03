import { useEffect, useState } from "react";
import type { SyncRecord } from "@plyrs/sync-protocol";
import type { Collection } from "@tanstack/db";
import type { CollectionRegistry } from "@plyrs/sync-client/tanstack";

// @tanstack/react-db は採用していない(導入当時は @tanstack/db の固定依存が catalog とずれて
// 二重インスタンス化したため)。subscribeChanges + useState の素朴な購読で足りる。
// collection.toArray は楽観的オーバーレイ込みの見え方(編集の即時反映はこれで実現する)。
// 購読は includeInitialState: true で張る。@tanstack/db は購読者ごとに「受け取り済みの行」を
// 追跡し、初期状態を受け取っていない購読者には購読前から在る行の変更・削除を届けない。
export function useCollectionRows(
  collection: Collection<SyncRecord, string> | undefined,
): SyncRecord[] {
  const [rows, setRows] = useState<SyncRecord[]>(() =>
    collection === undefined ? [] : collection.toArray,
  );
  useEffect(() => {
    if (collection === undefined) {
      setRows([]);
      return;
    }
    setRows(collection.toArray);
    const subscription = collection.subscribeChanges(() => setRows(collection.toArray), {
      includeInitialState: true,
    });
    return () => subscription.unsubscribe();
  }, [collection]);
  return rows;
}

// relation picker の候補: allowedTypes すべてのコレクションを束ねて購読する。
// フックはループで呼べないため、複数コレクションを 1 つの effect で購読する。
export function useRelationCandidates(
  registry: CollectionRegistry,
  allowedTypes: readonly string[],
): SyncRecord[] {
  const [rows, setRows] = useState<SyncRecord[]>([]);
  // 配列の identity 揺れで effect が空回りしないよう、結合キーで依存させる。
  // 区切り文字は "," 固定(type key は /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/ の形で "," を
  // 含み得ないため衝突しない。空文字区切りだと ["ab","c"] と ["a","bc"] が同じキーになってしまう)。
  const typesKey = allowedTypes.join(",");
  useEffect(() => {
    // exhaustive-deps 対策: 依存配列は typesKey のみ。allowedTypes への参照を effect 内に
    // 残さないよう、typesKey を分解した types を使う(allowedTypes は typesKey から再構成可能)。
    const types = typesKey.length === 0 ? [] : typesKey.split(",");
    const collections = types
      .map((typeKey) => registry.get(typeKey))
      .filter((collection) => collection !== undefined);
    const recompute = () =>
      setRows(
        collections
          .flatMap((collection) => collection.toArray)
          .toSorted((a, b) => a.id.localeCompare(b.id)),
      );
    recompute();
    const subscriptions = collections.map((collection) =>
      collection.subscribeChanges(() => recompute(), { includeInitialState: true }),
    );
    return () => {
      for (const subscription of subscriptions) {
        subscription.unsubscribe();
      }
    };
  }, [registry, typesKey]);
  return rows;
}
