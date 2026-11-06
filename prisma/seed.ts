import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { hashPassword } from "../lib/password";

const db = new PrismaClient();

// This project does not seed demo trips, sample bookings, fake users or mock
// inventory. The only records created here are the real local account you
// configure through env and the travel policy configuration.
async function main() {
  const email = process.env.DEV_USER_EMAIL?.trim();
  if (!email) {
    throw new Error(
      "DEV_USER_EMAIL is required. Set it in .env to the account you want to sign in as.",
    );
  }

  const name = process.env.DEV_USER_NAME?.trim() || email.split("@")[0];
  const role = process.env.DEV_USER_ROLE?.trim() || "travel_admin";
  if (!["employee", "manager", "travel_admin", "super_admin"].includes(role)) {
    throw new Error(
      `DEV_USER_ROLE must be employee, manager, travel_admin or super_admin (got "${role}").`,
    );
  }
  const department = process.env.DEV_USER_DEPARTMENT?.trim() || null;

  const policy = await db.travelPolicy.upsert({
    where: { name: "default" },
    // Never overwrite an existing policy configuration.
    update: {},
    create: {
      name: "default",
      currency: "INR",
      maxFlightEconomy: 100000,
      maxHotelPerNight: 25000,
      maxTotalPerTrip: 332000,
      requireApprovalAbove: 124500,
      advancePurchaseDays: 7,
      allowedCabins: JSON.stringify(["economy", "premium_economy"]),
    },
  });

  const user = await db.user.upsert({
    where: { email },
    // Roles are managed by a super admin after the account exists. The seed
    // only sets the role when creating the local bootstrap account, so running
    // the seed again cannot silently escalate an existing account.
    update: { name },
    create: {
      email,
      name,
      role,
      department,
      slackUserId: process.env.DEV_SLACK_USER_ID?.trim() || null,
    },
  });

  console.log(`Local account ready: ${user.email} (${user.role})`);
  console.log(`Policy ready: ${policy.name} (${policy.currency})`);

  // Issue 3 — real authentication. If DEV_USER_PASSWORD is set we set it
  // directly; otherwise we issue a one-time activation token so the operator
  // can visit /activate and set a password. We never print or store the
  // password in the console. We also never overwrite an existing password.
  const needsBootstrap = !user.passwordHash || !user.passwordSalt;
  if (needsBootstrap) {
    const password = process.env.DEV_USER_PASSWORD?.trim();
    if (password) {
      if (password.length < 8) {
        throw new Error("DEV_USER_PASSWORD must be at least 8 characters.");
      }
      const { salt, hash } = hashPassword(password);
      await db.user.update({
        where: { id: user.id },
        data: {
          passwordSalt: salt,
          passwordHash: hash,
          mustSetPassword: false,
          activationToken: null,
          activationExpiresAt: null,
        },
      });
      console.log(`Password set for ${user.email}. Sign in at /login.`);
    } else {
      const token = randomBytes(24).toString("hex");
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await db.user.update({
        where: { id: user.id },
        data: {
          activationToken: token,
          activationExpiresAt: expiresAt,
          mustSetPassword: true,
        },
      });
      console.log(
        `\nActivation token for ${user.email} (valid 24h):\n  ${token}\n` +
          `Visit /activate (or /activate?token=${token}) to set a password.\n`,
      );
    }
  } else {
    console.log(`Password already set for ${user.email}; no bootstrap token issued.`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
