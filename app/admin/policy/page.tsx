import { getCurrentUser, canViewAllTrips, canConfigurePolicy } from "@/lib/auth";
import { db } from "@/lib/db";
import { PolicyForm } from "./PolicyForm";

export default async function PolicyPage() {
  const user = await getCurrentUser();
  if (!canViewAllTrips(user)) {
    return (
      <div className="glass p-8 text-center">
        <p className="font-semibold">Travel operations access only</p>
        <p className="mt-1 text-sm text-slate-500">
          Policy configuration is available to travel admins and super admins.
        </p>
      </div>
    );
  }

  const policy = await db.travelPolicy.findUnique({ where: { name: "default" } });
  if (!policy) {
    return (
      <div className="glass p-8 text-center">
        <p className="font-semibold">No default policy configured</p>
        <p className="mt-1 text-sm text-slate-500">
          Run the seed to create the default policy, then configure it here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="glass p-6 sm:p-8">
        <p className="eyebrow">Administration</p>
        <h1 className="page-title mt-2">Policy configuration</h1>
        <p className="page-subtitle mt-2">
          Thresholds are stored in the policy currency and converted to the trip currency when
          evaluated. Every change is recorded in the audit log.
        </p>
      </section>

      <section className="glass p-5 sm:p-6">
        <PolicyForm policy={policy} canEdit={canConfigurePolicy(user)} />
      </section>
    </div>
  );
}
