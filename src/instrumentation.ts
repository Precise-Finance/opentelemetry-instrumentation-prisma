import {
  isWrapped,
  InstrumentationBase,
  InstrumentationNodeModuleDefinition,
} from "@opentelemetry/instrumentation";

import { context, trace, SpanKind } from "@opentelemetry/api";

import { SemanticAttributes } from "@opentelemetry/semantic-conventions";
import { PrismaClient } from "@prisma/client";
import { PrismaInstrumentationConfig } from "./types";
import { VERSION } from "./version";

export class PrismaInstrumentation extends InstrumentationBase {
  static readonly COMPONENT = "prisma";

  constructor(config: PrismaInstrumentationConfig = {}) {
    super(
      "@precise/opentelemetry-instrumentation-prisma",
      VERSION,
      Object.assign({}, config)
    );
  }

  protected init() {
    const Client = PrismaClient.prototype as any;
    this._wrap(Client, "_request", this._trace());
  }

  private flattenObject(obj, prefix = "") {
    return Object.keys(obj).reduce((acc, k) => {
      const pre = prefix.length ? prefix + "." : "";
      if (typeof obj[k] === "object")
        Object.assign(acc, this.flattenObject(obj[k], pre + k));
      else acc[pre + k] = obj[k];
      return acc;
    }, {});
  }

  private _trace() {
    const plugin = this;
    return function (original: () => any) {
      return function patchedRequest(this: any) {
        const args = arguments[0] as {
          clientMethod: string;
          action: string;
          model: string;
          args?: any;
        };

        const span = plugin.tracer.startSpan(
          args.clientMethod,
          {
            kind: SpanKind.CLIENT,
            attributes: {
              "prisma.action": args.action,
              "prisma.model": args.model,
              ...plugin.flattenObject(args.args, "prisma.args"),
            },
          },
          context.active()
        );

        return context.with(trace.setSpan(context.active(), span), () => {
          const promiseResponse = original.apply(
            this,
            arguments as any
          ) as Promise<any>;

          promiseResponse
            .catch((error) => {
              span.setAttribute("error", true);
              if (error.message) {
                span.setAttribute(
                  SemanticAttributes.EXCEPTION_MESSAGE,
                  error.message
                );
              }
              if (error.stack) {
                span.setAttribute(
                  SemanticAttributes.EXCEPTION_STACKTRACE,
                  error.stack
                );
              }
            })
            .finally(() => {
              span.end();
            });

          return promiseResponse;
        });
      };
    };
  }
}
