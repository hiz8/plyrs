import { Button, ModalDialog, TextField } from "@plyrs/ui";

export const Default = () => (
  <ModalDialog
    title="お知らせを追加"
    isOpen
    onOpenChange={() => {}}
    footer={
      <>
        <Button variant="secondary">キャンセル</Button>
        <Button variant="primary">追加</Button>
      </>
    }
  >
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <TextField label="タイトル" placeholder="タイトルを入力" isRequired />
      <TextField label="スラッグ" defaultValue="nenmatsu-nenshi" isMonospace />
    </div>
  </ModalDialog>
);

export const NoCloseButton = () => (
  <ModalDialog
    title="公開の準備ができました"
    isOpen
    onOpenChange={() => {}}
    showCloseButton={false}
    footer={<Button variant="primary">閉じる</Button>}
  >
    <p style={{ margin: 0 }}>年末年始の営業案内を公開できます。公開すると訪問者に表示されます。</p>
  </ModalDialog>
);
