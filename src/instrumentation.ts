import {
  isWrapped,
  InstrumentationBase,
  InstrumentationNodeModuleDefinition,
} from "@opentelemetry/instrumentation";

import { context, trace, SpanKind } from "@opentelemetry/api";

import { SemanticAttributes } from "@opentelemetry/semantic-conventions";
import * as prismaTypes from "@prisma/client";
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
    const prismaClientModule = new InstrumentationNodeModuleDefinition<
      typeof prismaTypes
    >(
      "@prisma/client",
      ["*"],
      (moduleExports: typeof prismaTypes) => {
        // This code somehow doesn't get called
        const PrismaClient = moduleExports.PrismaClient.prototype as any;

        // _request
        if (isWrapped(PrismaClient["_request"])) {
          this._unwrap(PrismaClient, "_request");
        }
        this._wrap(PrismaClient, "_request", this._trace());

        return moduleExports;
      },
      (moduleExports: typeof prismaTypes) => {
        const PrismaClient = moduleExports.PrismaClient.prototype as any;
        this._unwrap(PrismaClient, "_request");
      }
    );

    // _request
    if (isWrapped(PrismaClient["_request"])) {
      this._unwrap(PrismaClient, "_request");
    }
    this._wrap(PrismaClient, "_request", this._trace());

    return [prismaClientModule];
  }

  private _trace() {
    const plugin = this;
    return function (original: () => any) {
      return function patchedRequest(this: any) {
        const args = arguments[0] as {
          clientMethod: string;
        };

        const span = plugin.tracer.startSpan(
          args.clientMethod,
          {
            kind: SpanKind.CLIENT,
            attributes: {
              component: "prisma",
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
