/**
 * Copied verbatim from the authoritative, compiled Counter.synq example in
 * network-components/synq-language/examples/Counter.synq.
 */
export const QUICK_START_SYNQ = `contract Counter {
    counter: UInt256 public;

    @public function increment() -> UInt256 {
        counter = counter + 1;
        return counter;
    }

    @public function get() -> UInt256 {
        return counter;
    }
}`;

export const QUICK_START_LINES = QUICK_START_SYNQ.split("\n");

export const SYNQ_TEMPLATE_FILES = {
  "contracts/Counter.synq": QUICK_START_SYNQ,
  "synq.toml": `[package]
name = "counter-starter"

[network]
id = "synergy-testnet-v3"
chain_id = 1266

[runtime]
target = "AIVM"

[security]
signature_algorithm = "ML-DSA-65"`,
  "README.md": `# Counter starter

This project was created from the explicit ForgeIDE SynQ starter template.
ForgeIDE can compile this contract locally and run deterministic artifact
tests. On-chain AIVM deployment remains blocked until Testnet v3 exposes and
proves the general-purpose SynQ admission and AIVM execution path.`,
} as const;
