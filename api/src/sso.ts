import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import MicrosoftStrategy from "passport-microsoft";
import { env } from "./env";
import { prisma } from "./prisma";
import { ensureUniqueHandle } from "./handle";

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    callbackURL: process.env.GOOGLE_CALLBACK_URL!,
}, async (_access: any, _refresh: any, profile: any, done: (err: any, user?: any) => void) => {
  try {
    const provider = "google";
    const providerId = profile.id;
    const email = profile.emails?.[0]?.value || null;
    let ident = await prisma.identity.findUnique({ where: { provider_providerId: { provider, providerId } } });
    if (!ident) {
      // find user by email or create new
      let user = email ? await prisma.user.findUnique({ where: { email } }) : null;
      if (!user) {
        const base = (profile.username || email?.split("@")[0] || "user");
        const handle = await ensureUniqueHandle(base);
        user = await prisma.user.create({ data: { email, name: profile.displayName || base, handle } });
      }
      ident = await prisma.identity.create({ data: { provider, providerId, userId: user.id } });
    }
    const user = await prisma.user.findUnique({ where: { id: ident.userId } });
    if (user) return done(null, user);
    return done(null, false);
  } catch (e) { return done(e as any); }
}));

// passport.use(new MicrosoftStrategy({
//   clientID: env.MS_CLIENT_ID,
//   clientSecret: env.MS_CLIENT_SECRET,
//   callbackURL: env.MS_CALLBACK_URL,
//   scope: ["user.read"]
// }, async (_accessToken: string, _refreshToken: string, profile: any, done: any) => {
//   try {
//     const provider = "microsoft";
//     const providerId = profile.id;
//     const email = (profile.emails && profile.emails[0]) || profile._json?.mail || profile._json?.userPrincipalName || null;
//     let ident = await prisma.identity.findUnique({ where: { provider_providerId: { provider, providerId } } });
//     if (!ident) {
//       let user = email ? await prisma.user.findUnique({ where: { email } }) : null;
//       if (!user) {
//         const base = (profile.username || (email ? email.split("@")[0] : "user"));
//         const handle = await ensureUniqueHandle(base);
//         user = await prisma.user.create({ data: { email, name: profile.displayName || base, handle } });
//       }
//       ident = await prisma.identity.create({ data: { provider, providerId, userId: user.id } });
//     }
//     const user = await prisma.user.findUnique({ where: { id: ident.userId } });
//     return done(null, user);
//   } catch (e) { return done(e as any); }
// }));

export default passport;