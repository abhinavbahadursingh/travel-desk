import { redirect } from "next/navigation";
import { tryGetCurrentUser } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const user = await tryGetCurrentUser();
  if (user) redirect("/");
  return (
    <div className="w-full max-w-md space-y-6">
      <div className="glass p-6 sm:p-8">
        <p className="eyebrow">Corporate Travel Agent</p>
        <h1 className="page-title mt-2">Sign in</h1>
        <p className="page-subtitle mt-2">
          Use your corporate email and password. New account? Ask a super admin
          for an activation link.
        </p>
      </div>
      <LoginForm />
    </div>
  );
}
