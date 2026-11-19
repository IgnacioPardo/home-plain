import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { RequestContext } from "./auth/auth.schema.ts";

export const t = initTRPC.context<RequestContext>().create({ transformer: superjson });
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
    if (!ctx.session)
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Iniciá sesión para continuar." });
    return next({ ctx: { session: ctx.session } });
});
export const ownerProcedure = protectedProcedure.use(({ ctx, next }) => {
    if (ctx.session.role !== "owner")
        throw new TRPCError({
            code: "FORBIDDEN",
            message: "Solo el propietario puede cambiar compras.",
        });
    return next();
});
