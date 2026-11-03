import journal from "./meta/_journal.json";
import m0000 from "./0000_productive_trauma.sql";
import m0001 from "./0001_aromatic_zaran.sql";
import m0002 from "./0002_glorious_lightspeed.sql";
import m0003 from "./0003_high_sersi.sql";
import m0004 from "./0004_aberrant_killraven.sql";
import m0005 from "./0005_famous_mister_sinister.sql";
import m0006 from "./0006_brown_roland_deschain.sql";
import m0007 from "./0007_equal_roland_deschain.sql";
import m0008 from "./0008_records_fts.sql";

export default {
  journal,
  migrations: {
    m0000,
    m0001,
    m0002,
    m0003,
    m0004,
    m0005,
    m0006,
    m0007,
    m0008,
  },
};
