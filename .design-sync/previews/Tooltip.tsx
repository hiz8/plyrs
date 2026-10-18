import { Button, Tooltip } from "@plyrs/ui";
import { useEffect, useRef } from "react";

export const Open = () => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector("button")?.focus();
  }, []);
  return (
    <div ref={ref} style={{ padding: "48px 120px" }}>
      <Tooltip content="2026/10/17 10:00" delay={0} placement="bottom">
        <Button variant="secondary">10 分前</Button>
      </Tooltip>
    </div>
  );
};
