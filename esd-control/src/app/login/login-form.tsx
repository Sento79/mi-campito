"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, Input, Alert } from "@/components/ui/core";
import { loginAction } from "./actions";
import { AlertTriangle } from "lucide-react";

const schema = z.object({
  email: z.string().trim().email("Introduzca un correo válido"),
  password: z.string().min(1, "Introduzca la contraseña"),
});

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  return (
    <form
      className="mt-6 space-y-4"
      noValidate
      onSubmit={handleSubmit(async (v) => {
        setError(null);
        const r = await loginAction(v);
        if (!r.ok) setError(r.error);
        else {
          router.replace(next);
          router.refresh();
        }
      })}
    >
      {error ? (
        <Alert tone="bad" icon={AlertTriangle}>
          {error}
        </Alert>
      ) : null}
      <Field label="Correo electrónico" htmlFor="email" error={formState.errors.email?.message}>
        <Input id="email" type="email" autoComplete="username" autoFocus aria-invalid={!!formState.errors.email} {...register("email")} />
      </Field>
      <Field label="Contraseña" htmlFor="password" error={formState.errors.password?.message}>
        <Input id="password" type="password" autoComplete="current-password" aria-invalid={!!formState.errors.password} {...register("password")} />
      </Field>
      <Button type="submit" className="w-full" loading={formState.isSubmitting}>
        Entrar
      </Button>
    </form>
  );
}
