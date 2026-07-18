// §6: email は保存・照合の前に必ずこの正規化を通す(signup / login / super 系 / owner 指定)。
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
