export type ExecuteNotifyInput = {
  notify_id: string;
  template_id: string;
  input: Record<string, unknown>;
};

export type ExecuteNotifyResult = {
  status: number;
  body: Record<string, unknown>;
};

type JsonResponder = {
  status: (code: number) => JsonResponder;
  json: (body: unknown) => unknown;
};

export type ExecuteNotifyHttpHandler = (req: any, res: any) => Promise<unknown> | unknown;

let routeHandler: ExecuteNotifyHttpHandler | null = null;

export function registerExecuteNotifyRoute(handler: ExecuteNotifyHttpHandler): void {
  routeHandler = handler;
}

/** Invoke the registered execute-notify handler without HTTP (workers / tests). */
export async function executeNotify(input: ExecuteNotifyInput): Promise<ExecuteNotifyResult> {
  if (!routeHandler) {
    throw new Error("execute-notify route handler not registered; host must bind createAgentOs().bindExecuteNotify");
  }

  return new Promise((resolve, reject) => {
    const req = {
      body: {
        notify_id: input.notify_id,
        template_id: input.template_id,
        input: input.input,
      },
    };

    let statusCode = 200;
    const res: JsonResponder = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(body: unknown) {
        const obj =
          body && typeof body === "object" && !Array.isArray(body)
            ? (body as Record<string, unknown>)
            : { data: body };
        resolve({ status: statusCode, body: obj });
        return this;
      },
    };

    Promise.resolve(routeHandler!(req, res)).catch(reject);
  });
}
