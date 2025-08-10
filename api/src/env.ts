import 'dotenv/config';
export const env = {
  DATABASE_URL: process.env.DATABASE_URL!,
  JWT_SECRET: process.env.JWT_SECRET!,
  CLIENT_URL: process.env.CLIENT_URL || "http://localhost:5173",
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID!,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET!,
  GOOGLE_CALLBACK_URL: process.env.GOOGLE_CALLBACK_URL!,
  MS_CLIENT_ID: process.env.MS_CLIENT_ID!,
  MS_CLIENT_SECRET: process.env.MS_CLIENT_SECRET!,
  MS_SCOPE: process.env.MS_SCOPE || "https://graph.microsoft.com/User.Read",
  MS_TENANT: process.env.MS_TENANT || "common",
  MS_CALLBACK_URL: process.env.MS_CALLBACK_URL!,
};