/// <reference types="vite/client" />

import type { RuntimeStatus } from "../shared/ipc.js";

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}

declare global {
  interface Window {
    happyagent: {
      getRuntimeStatus(): Promise<RuntimeStatus>;
      onRuntimeStatus(handler: (status: RuntimeStatus) => void): () => void;
    };
  }
}
