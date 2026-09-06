import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { config } from "../../config/env.js";
import { prisma } from "../../db/prisma.js";
import { childLogger } from "../../utils/logger.js";

const log = childLogger({ operation: "auth.google" });

export function configureGoogleOAuth(): void {
  passport.use(
    new GoogleStrategy(
      {
        clientID: config.google.clientId,
        clientSecret: config.google.clientSecret,
        callbackURL: config.google.callbackUrl,
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) {
            done(new Error("Google profile has no email"));
            return;
          }
          const user = await prisma.user.upsert({
            where: { googleId: profile.id },
            create: {
              googleId: profile.id,
              email,
              name: profile.displayName || email,
              avatarUrl: profile.photos?.[0]?.value ?? null,
            },
            update: {
              email,
              name: profile.displayName || email,
              avatarUrl: profile.photos?.[0]?.value ?? null,
            },
          });
          done(null, user);
        } catch (err) {
          log.error({ err }, "google profile handling failed");
          done(err as Error);
        }
      },
    ),
  );
}
