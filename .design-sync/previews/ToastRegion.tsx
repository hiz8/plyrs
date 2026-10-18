import { ToastRegion, createToaster } from "@plyrs/ui";
import { RotateCw } from "lucide-react";
import { useEffect, useState } from "react";

export const SuccessAndError = () => {
  const [toaster] = useState(() => createToaster());
  useEffect(() => {
    toaster.success("お知らせを公開しました");
    toaster.error("メディアを削除できませんでした", {
      label: "再試行",
      icon: RotateCw,
      onAction: () => {},
    });
  }, [toaster]);
  return <ToastRegion toaster={toaster} />;
};
