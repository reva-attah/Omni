import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import type { DataModel } from "./_generated/dataModel";
import { ConvexError } from "convex/values";

const TriumPassword = Password<DataModel>({
  profile(params) {
    const email = typeof params.email === "string" ? params.email.trim().toLowerCase() : "";
    if (!/^[^\s@]+@trium\.ng$/i.test(email)) {
      throw new ConvexError("Omni accounts require a @trium.ng email address.");
    }
    return { email };
  },
});

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [TriumPassword],
});
