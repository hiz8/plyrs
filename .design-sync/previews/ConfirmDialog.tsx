import { ConfirmDialog } from "@plyrs/ui";

export const Danger = () => (
  <ConfirmDialog
    title="お知らせを削除しますか"
    isOpen
    onOpenChange={() => {}}
    confirmLabel="削除する"
    tone="danger"
    onConfirm={() => {}}
  >
    「年末年始の営業案内」を削除します。公開中のため、サイトからも表示されなくなります。この操作は元に戻せません。
  </ConfirmDialog>
);

export const Primary = () => (
  <ConfirmDialog
    title="変更を公開しますか"
    isOpen
    onOpenChange={() => {}}
    confirmLabel="公開する"
    cancelLabel="あとで"
    tone="primary"
    onConfirm={() => {}}
  >
    未反映の変更が 3 件あります。公開するとサイトに反映されます。
  </ConfirmDialog>
);

export const Pending = () => (
  <ConfirmDialog
    title="メンバーを削除しますか"
    isOpen
    onOpenChange={() => {}}
    confirmLabel="削除する"
    tone="danger"
    isPending
    onConfirm={() => {}}
  >
    山田 太郎さんをこのサイトから削除します。
  </ConfirmDialog>
);
