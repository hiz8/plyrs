import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { v7 as uuidv7 } from "uuid";
import { toaster } from "@plyrs/ui";
import { TypeEditor } from "../../../../../components/content-types/type-editor";
import {
  buildDefinition,
  emptyTypeDraft,
  type TypeDraft,
} from "../../../../../lib/content-type-form";
import { errorMessage } from "../../../../../lib/error-messages";
import { CONTENT_TYPE_LABELS } from "../../../../../lib/labels";
import { contentTypesQueryOptions } from "../../../../../lib/queries";
import { useCan } from "../../../../../lib/use-can";

export const Route = createFileRoute("/t/$tenantSlug/settings/content-types/new")({
  // 重複の検証に使う型の一覧は常に最新から取る(§11)
  loader: ({ context }) =>
    context.queryClient.fetchQuery(contentTypesQueryOptions(context.adminApi, context.tenant.id)),
  component: NewContentTypePage,
});

// 新規は空の下書きから始める。レンダーごとに作り直さないようモジュールで 1 つ持つ
const INITIAL: TypeDraft = emptyTypeDraft();

function NewContentTypePage() {
  const { adminApi, tenant, queryClient } = Route.useRouteContext();
  const { tenantSlug } = Route.useParams();
  const navigate = useNavigate();
  const labels = CONTENT_TYPE_LABELS;
  const canManage = useCan("type:manage");
  const { data: contentTypes } = useSuspenseQuery(contentTypesQueryOptions(adminApi, tenant.id));
  const toList = () =>
    navigate({ to: "/t/$tenantSlug/settings/content-types", params: { tenantSlug } });

  // 作る権限が無い人は一覧へ戻す(読み取り専用で開く型が無いため)
  useEffect(() => {
    if (!canManage) void toList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManage]);

  const save = useMutation({
    mutationFn: async (draft: TypeDraft) => {
      const built = buildDefinition({ id: uuidv7(), version: 1, draft });
      if (!built.ok) {
        // 描画側で検証済みなので通常は来ない(保険)
        toaster.error(built.errors.join(" "));
        return false;
      }
      await adminApi.putContentType(tenant.id, built.definition);
      return true;
    },
    onSuccess: async (saved) => {
      if (!saved) return;
      await queryClient.invalidateQueries({ queryKey: ["content-types", tenant.id] });
      toaster.success(labels.editor.created);
      await toList();
    },
    onError: (cause) => toaster.error(errorMessage(cause, labels.editor.saveFailed)),
  });

  if (!canManage) return null;
  return (
    <TypeEditor
      slug={tenantSlug}
      mode="new"
      initial={INITIAL}
      original={[]}
      typeName={labels.createTitle}
      existingTypes={contentTypes}
      records={null}
      onSubmit={async (draft) => {
        await save.mutateAsync(draft).catch(() => undefined);
      }}
      onCancel={() => void toList()}
      isPending={save.isPending}
    />
  );
}
