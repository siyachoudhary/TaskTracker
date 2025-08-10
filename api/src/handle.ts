import { prisma } from "./prisma";

export async function ensureUniqueHandle(base: string) {
  const slug = base.toLowerCase().replace(/[^a-z0-9_\.~-]/g, "");
  if (!slug) return cryptoSuffix("user");
  let handle = slug;
  let i = 0;
  while (true) {
    const exists = await prisma.user.findUnique({ where: { handle } });
    if (!exists) return handle;
    i += 1; handle = `${slug}${i}`;
  }
}

export function cryptoSuffix(prefix = "u") {
  const r = [...crypto.getRandomValues(new Uint8Array(3))].map(b => (b%36).toString(36)).join("");
  return `${prefix}${r}`;
}