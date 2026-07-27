import { PrismaClient, GlobalRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = 'admin@theonemind.kr';
  const password = '@1234567';
  const hash = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { email },
    update: { role: GlobalRole.ADMIN },
    create: {
      email,
      name: 'Admin',
      passwordHash: hash,
      role: GlobalRole.ADMIN,
    },
  });

  console.log(`Admin user created: ${user.email} (${user.role})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
