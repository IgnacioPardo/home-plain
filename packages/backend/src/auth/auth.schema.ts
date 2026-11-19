import { z } from "zod";

export const authSessionSchema = z.object({
    username: z.string(),
    role: z.enum(["owner", "commenter"]),
    csrfToken: z.string(),
});
export type AuthSession = z.infer<typeof authSessionSchema>;
export type RequestContext = {
    session: (AuthSession & { userId: string; householdId: string }) | null;
};
