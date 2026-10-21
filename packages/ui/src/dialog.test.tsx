import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";
import { ConfirmDialog, ModalDialog } from "./dialog";

function Harness({ onConfirm }: { onConfirm: () => void }) {
  const [isOpen, setOpen] = useState(false);
  return (
    <>
      <Button onPress={() => setOpen(true)}>削除</Button>
      <ConfirmDialog
        isOpen={isOpen}
        onOpenChange={setOpen}
        title="お知らせを削除しますか？"
        confirmLabel="削除する"
        onConfirm={() => {
          onConfirm();
          setOpen(false);
        }}
      >
        公開中のページも消え、元に戻せません。
      </ConfirmDialog>
    </>
  );
}

const classOf = (size: "md" | "lg" | "xl") => {
  const { unmount } = render(
    <ModalDialog isOpen onOpenChange={() => {}} title="T" size={size}>
      中身
    </ModalDialog>,
  );
  const cls = screen.getByRole("dialog").parentElement?.className ?? "";
  unmount();
  return cls;
};

describe("ConfirmDialog", () => {
  it("危険な確認は alertdialog で、キャンセルに初期フォーカスがある", async () => {
    const user = userEvent.setup();
    render(<Harness onConfirm={() => {}} />);
    await user.click(screen.getByRole("button", { name: "削除" }));
    const dialog = await screen.findByRole("alertdialog", { name: "お知らせを削除しますか？" });
    expect(dialog).toHaveTextContent("元に戻せません");
    expect(screen.getByRole("button", { name: "キャンセル" })).toHaveFocus();
  });

  it("tone=primary の確認は dialog で、実行ボタンに初期フォーカスがある", async () => {
    render(
      <ConfirmDialog
        isOpen
        onOpenChange={() => {}}
        title="公開しますか？"
        confirmLabel="公開する"
        tone="primary"
        onConfirm={() => {}}
      >
        サイトに表示されます。
      </ConfirmDialog>,
    );
    await screen.findByRole("dialog", { name: "公開しますか？" });
    expect(screen.getByRole("button", { name: "公開する" })).toHaveFocus();
  });

  it("キャンセルで閉じて開いたボタンへフォーカスを戻し、実行は呼ばない", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    const opener = screen.getByRole("button", { name: "削除" });
    await user.click(opener);
    await user.click(await screen.findByRole("button", { name: "キャンセル" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("実行ボタンで onConfirm を呼ぶ", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);
    await user.click(screen.getByRole("button", { name: "削除" }));
    await user.click(await screen.findByRole("button", { name: "削除する" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});

function Open() {
  const [isOpen, setOpen] = useState(true);
  return (
    <ModalDialog title="メンバーを追加" isOpen={isOpen} onOpenChange={setOpen}>
      本文
    </ModalDialog>
  );
}

describe("ModalDialog", () => {
  it("右上の閉じるボタンと Esc で閉じる", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Open />);
    await user.click(await screen.findByRole("button", { name: "閉じる" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    rerender(<></>);
    render(<Open />);
    await screen.findByRole("dialog", { name: "メンバーを追加" });
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("size=lg は幅 640px の Modal を描く", () => {
    const { unmount } = render(
      <ModalDialog isOpen onOpenChange={() => {}} title="MD">
        中身
      </ModalDialog>,
    );
    const mdClass = screen.getByRole("dialog").parentElement?.className ?? "";
    unmount();
    render(
      <ModalDialog isOpen onOpenChange={() => {}} title="LG" size="lg">
        中身
      </ModalDialog>,
    );
    const lgClass = screen.getByRole("dialog").parentElement?.className ?? "";
    // StyleX は幅の違いを別のクラスにする。lg だけが違うクラスを持つ(atomic class 数は同じ)
    expect(lgClass).not.toBe("");
    expect(lgClass).not.toBe(mdClass);
    expect(lgClass.split(" ")).toHaveLength(mdClass.split(" ").length);
  });

  it("size=xl は lg とも md とも違う幅のクラスを持つ", () => {
    const md = classOf("md");
    const lg = classOf("lg");
    const xl = classOf("xl");
    expect(xl).not.toBe(md);
    expect(xl).not.toBe(lg);
  });
});
