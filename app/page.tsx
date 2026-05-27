import { redirect } from "next/navigation";

/**
 * La home redirige a la primera pantalla del flujo autenticado.
 * Anónimos: el middleware los manda a /landing antes de llegar aquí.
 */
export default function Home() {
  redirect("/connect-accounts");
}
