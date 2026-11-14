"use client";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/app/actions";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/**
 * A form bound to a server action. Shows inline success/error, disables the submit
 * button while pending (no double submits), and can reset or collapse on success.
 */
export function ActionForm({
  action,
  children,
  className = "",
  resetOnSuccess = false,
  confirm,
  onSuccessClose,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  confirm?: string;
  onSuccessClose?: boolean;
}) {
  // Announce success as soon as the action resolves: the form itself may unmount in the
  // same render (e.g. an approved item leaves the inbox), so an effect would be too late.
  const [state, formAction] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await action(prev, fd);
    if (r?.ok && r.message) window.dispatchEvent(new CustomEvent("fe-toast", { detail: r.message }));
    return r;
  }, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
    if (state.ok && onSuccessClose) ref.current?.closest("details")?.removeAttribute("open");
  }, [state, resetOnSuccess, onSuccessClose]);
  return (
    <form
      ref={ref}
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      <FormMessage state={state} />
    </form>
  );
}

function FormMessage({ state }: { state: ActionState }) {
  const { pending } = useFormStatus();
  // Success is announced by the app-wide toast (the form may disappear once its item is done).
  if (pending || !state.error) return null;
  return (
    <p key={state.at} role="alert" className="mt-2 rounded-lg bg-danger-100 px-3 py-2 text-sm text-danger">
      {state.error}
    </p>
  );
}

/** App-wide confirmation toast. Lives in the root layout so it survives page re-renders. */
export function Toaster() {
  const [msg, setMsg] = useState<{ text: string; id: number } | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const on = (e: Event) => {
      setMsg({ text: (e as CustomEvent<string>).detail, id: Date.now() });
      clearTimeout(timer);
      timer = setTimeout(() => setMsg(null), 3500);
    };
    window.addEventListener("fe-toast", on);
    return () => {
      window.removeEventListener("fe-toast", on);
      clearTimeout(timer);
    };
  }, []);
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4 lg:bottom-8">
      {msg && (
        <div key={msg.id} role="status" className="pointer-events-auto rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-white shadow-lg">
          ✓ {msg.text}
        </div>
      )}
    </div>
  );
}

export function Submit({
  children,
  variant = "primary",
  small,
  className = "",
  name,
  value,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger";
  small?: boolean;
  className?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      aria-busy={pending}
      className={`btn btn-${variant} ${small ? "btn-small" : ""} ${className}`}
    >
      {pending ? "Working…" : children}
    </button>
  );
}

/** A per-render idempotency key, so a retried or double-tapped request is applied once. */
export function IdempotencyKey() {
  const [key] = useState(() => crypto.randomUUID());
  return <input type="hidden" name="key" value={key} />;
}

export function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

/** Live Points → AUD quote for cash-out and pricing inputs. */
export function PointsInput({
  name,
  centsPerPoint,
  defaultValue,
  max,
  placeholder,
  required = true,
}: {
  name: string;
  centsPerPoint: number;
  defaultValue?: number;
  max?: number;
  placeholder?: string;
  required?: boolean;
}) {
  const [v, setV] = useState(defaultValue ? String(defaultValue) : "");
  const n = Number.parseInt(v.replace(/[,\s]/g, ""), 10);
  const valid = Number.isSafeInteger(n) && n > 0;
  const cents = valid ? n * centsPerPoint : 0;
  return (
    <div>
      <input
        name={name}
        inputMode="numeric"
        pattern="[0-9,]*"
        className="input font-display text-lg"
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder={placeholder ?? "0"}
        required={required}
        autoComplete="off"
      />
      <span className="mt-1 block text-xs text-muted">
        {valid ? `= $${Math.trunc(cents / 100).toLocaleString("en-AU")}.${String(cents % 100).padStart(2, "0")}` : " "}
        {valid && max !== undefined && n > max ? ` (more than the ${max.toLocaleString("en-AU")} available)` : ""}
      </span>
    </div>
  );
}

/** Small client-side image downscale so phone photos upload quickly (max 1600px JPEG). */
export function PhotoInput({ name }: { name: string }) {
  const [preview, setPreview] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
      const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.82));
      if (blob && ref.current) {
        const dt = new DataTransfer();
        dt.items.add(new File([blob], "photo.jpg", { type: "image/jpeg" }));
        ref.current.files = dt.files;
        setPreview(URL.createObjectURL(blob));
      }
    } catch {
      setPreview(URL.createObjectURL(file));
    }
  }
  return (
    <div>
      <input ref={ref} type="file" name={name} accept="image/*" capture="environment" onChange={onChange} className="block w-full text-sm" />
      {preview && <img src={preview} alt="Selected photo preview" className="mt-2 max-h-48 rounded-lg" />}
    </div>
  );
}

/** Toggle that always posts a value, so unchecking is saved. */
export function Toggle({ name, defaultChecked, label, hint }: { name: string; defaultChecked: boolean; label: string; hint?: string }) {
  return (
    <label className="flex items-start gap-3 py-1">
      <input type="hidden" name={`${name}__present`} value="1" />
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-1 h-5 w-5 accent-[#0e3b36]" />
      <span>
        <span className="block font-medium">{label}</span>
        {hint && <span className="block text-sm text-muted">{hint}</span>}
      </span>
    </label>
  );
}

/** Dynamic milestone list for projects. */
export function MilestoneEditor() {
  const [rows, setRows] = useState([0, 1]);
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={r} className="flex gap-2">
          <input name="mTitle" className="input" placeholder={`Milestone ${i + 1}`} aria-label={`Milestone ${i + 1} title`} />
          <input name="mPoints" className="input w-28" inputMode="numeric" placeholder="Points" aria-label={`Milestone ${i + 1} Points`} />
        </div>
      ))}
      <button type="button" className="btn btn-secondary btn-small" onClick={() => setRows((x) => [...x, (x.at(-1) ?? 0) + 1])}>
        Add milestone
      </button>
    </div>
  );
}

/** Show/hide fields based on a select value without leaving the form. */
export function DependsOn({ field, values, children }: { field: string; values: string[]; children: ReactNode }) {
  const [show, setShow] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const update = () => {
      const el = form.elements.namedItem(field) as HTMLSelectElement | RadioNodeList | null;
      setShow(!!el && values.includes(String((el as HTMLSelectElement).value)));
    };
    update();
    form.addEventListener("change", update);
    return () => form.removeEventListener("change", update);
  }, [field, values]);
  return (
    <div ref={ref} hidden={!show} className="space-y-3">
      {children}
    </div>
  );
}
