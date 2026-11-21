export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
    public fieldErrors?: Record<string, string>,
  ) {
    super(message);
  }
}
export class ForbiddenError extends AppError {
  constructor(message = "No tiene permiso para esta acción") {
    super(message, 403);
  }
}
export class NotFoundError extends AppError {
  constructor(message = "No encontrado") {
    super(message, 404);
  }
}

/** Traduce errores de PostgreSQL a mensajes seguros para el usuario. */
export function toUserMessage(e: unknown): { message: string; status: number; fieldErrors?: Record<string, string> } {
  if (e instanceof AppError) return { message: e.message, status: e.status, fieldErrors: e.fieldErrors };
  const pg = e as { code?: string; message?: string; constraint_name?: string; detail?: string };
  switch (pg?.code) {
    case "42501":
      // Mensajes de nuestros disparadores (en español) o RLS
      if (pg.message && !/row-level security|permission denied/i.test(pg.message)) return { message: pg.message, status: 403 };
      return { message: "Permiso denegado por las políticas de seguridad", status: 403 };
    case "23505":
      return { message: "Ya existe un registro con ese identificador", status: 409 };
    case "23503":
      return { message: "El registro está referenciado o hace referencia a un elemento inexistente", status: 409 };
    case "23514":
      return { message: pg.message?.startsWith("El ") ? pg.message : "Los datos no cumplen las restricciones de integridad", status: 400 };
    case "22P02":
    case "22023":
      return { message: "Datos con formato no válido", status: 400 };
  }
  return { message: "Error interno. El incidente ha quedado registrado.", status: 500 };
}
