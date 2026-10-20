import type { Role } from "../lib/permissions";

// vi.mock("./components/settings/role-select", ...) の差し替え先。RAC のセレクトは jsdom で扱いにくいので
// ネイティブの select にする(実物と違い isRole の絞り込みはしない。テストの値は有効なロールだけ)
export function RoleSelectMock(props: {
  label: string;
  value: Role;
  onChange: (role: Role) => void;
}) {
  return (
    <select
      aria-label={props.label}
      value={props.value}
      onChange={(event) => props.onChange(event.target.value as Role)}
    >
      {["owner", "editor", "viewer"].map((role) => (
        <option key={role} value={role}>
          {role}
        </option>
      ))}
    </select>
  );
}
