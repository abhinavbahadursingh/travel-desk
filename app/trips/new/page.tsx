import { NewTripForm } from "./NewTripForm";

export default function NewTripPage() {
  return (
    <div className="space-y-6">
      <div className="glass p-6 sm:p-8">
        <p className="eyebrow">New request</p>
        <h1 className="page-title mt-2">Plan a new trip</h1>
        <p className="page-subtitle mt-2 max-w-xl">
          Describe the trip. We&apos;ll search the web for real flights, hotels, trains and cabs,
          then check the estimate against company policy before you submit.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <span className="glass-pill">1 · Describe the trip</span>
          <span className="glass-pill">2 · Compare real options</span>
          <span className="glass-pill">3 · Submit for approval</span>
        </div>
      </div>

      <NewTripForm />
    </div>
  );
}
