import { ActivateForm } from "./ActivateForm";

export const dynamic = "force-dynamic";

export default async function ActivatePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;
  return (
    <div className="w-full max-w-md space-y-6">
      <div className="glass p-6 sm:p-8">
        <p className="eyebrow">Corporate Travel Agent</p>
        <h1 className="page-title mt-2">Activate your account</h1>
        <p className="page-subtitle mt-2">
          Paste the activation token you received from a super admin, then set a
          password of 8+ characters.
        </p>
      </div>
      <ActivateForm initialToken={params.token ?? ""} />
    </div>
  );
}
