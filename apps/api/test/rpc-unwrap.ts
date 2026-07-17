import type { PublicationState } from "../src/do/publish";

export * from "../src/rpc-unwrap";

export function asPublicationState(value: unknown): PublicationState {
  return value as PublicationState;
}
