export {
  executeNotify,
  registerExecuteNotifyRoute as bindExecuteNotify,
  type ExecuteNotifyInput,
  type ExecuteNotifyResult,
  type ExecuteNotifyHttpHandler,
} from "../runtime/execute-notify.js";

/** @deprecated use bindExecuteNotify */
export { registerExecuteNotifyRoute } from "../runtime/execute-notify.js";
