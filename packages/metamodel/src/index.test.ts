import { describe, expect, it } from "vitest";
import * as metamodel from "./index";

describe("@plyrs/metamodel public surface", () => {
  it("exports the full public API", () => {
    expect(metamodel.SYSTEM_FIELD_KEYS).toBeDefined();
    expect(metamodel.WORKFLOW_STATUSES).toBeDefined();
    expect(metamodel.fieldDefinitionSchema).toBeDefined();
    expect(metamodel.contentTypeDefinitionSchema).toBeDefined();
    expect(metamodel.buildFieldValueSchema).toBeTypeOf("function");
    expect(metamodel.buildRecordInputSchema).toBeTypeOf("function");
    expect(metamodel.splitRecordInput).toBeTypeOf("function");
    expect(metamodel.tolerantReadData).toBeTypeOf("function");
    expect(metamodel.relationRefSchema).toBeDefined();
    expect(metamodel.richTextEnvelopeSchema).toBeDefined();
    expect(metamodel.uuidSchema).toBeDefined();
  });
});
