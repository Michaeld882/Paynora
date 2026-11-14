/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Deployed Paynora contract on Arc Mainnet. Empty until you deploy contracts/Paynora.sol. */
  readonly VITE_PAYNORA_ADDRESS?: string
  /** Block number the Paynora contract was deployed at. */
  readonly VITE_PAYNORA_DEPLOY_BLOCK?: string
  /** Set to "off" to disable the dev-only Preview Test Mode. */
  readonly VITE_PAYNORA_TEST_MODE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
