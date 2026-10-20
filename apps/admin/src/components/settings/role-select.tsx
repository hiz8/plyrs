import { Select } from "@plyrs/ui";
import { ROLE_LABELS } from "../../lib/labels";
import { isRole, ROLES, type Role } from "../../lib/permissions";

const ITEMS = ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] }));

// ロールの選択(G9)。router テストで vi.mock する境界
export function RoleSelect({
  label,
  value,
  onChange,
  isDisabled,
  size,
  isLabelHidden,
}: {
  label: string;
  value: Role;
  onChange: (role: Role) => void;
  isDisabled?: boolean;
  size?: "md" | "sm";
  isLabelHidden?: boolean;
}) {
  return (
    <Select
      label={label}
      items={ITEMS}
      selectedValue={value}
      onChange={(next) => {
        if (isRole(next)) onChange(next);
      }}
      {...(isDisabled === undefined ? {} : { isDisabled })}
      {...(size === undefined ? {} : { size })}
      {...(isLabelHidden === undefined ? {} : { isLabelHidden })}
    />
  );
}
